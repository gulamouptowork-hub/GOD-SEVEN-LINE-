// Valida supabase/schema.sql + seed.sql num Postgres real (PGlite, Postgres em WASM) com stubs mínimos
// do Supabase (roles anon/authenticated, auth.uid(), storage) e testa create_order, RLS e permissões.
// Opcional: corre só se o PGlite estiver instalado →  npm i --no-save @electric-sql/pglite && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opcional */ }
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

test('supabase: schema, seed, create_order, RLS e storage', { skip: PGlite ? false : 'PGlite não instalado (npm i --no-save @electric-sql/pglite)', timeout: 240000 }, async t => {
  const db = new PGlite();
  const ok = message => t.diagnostic(message);


  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);

  const schema = fs.readFileSync(`${ROOT}/supabase/schema.sql`, 'utf8');
  await db.exec(schema);
  ok('schema.sql executa sem erros');
  await db.exec(schema);
  ok('schema.sql é re-executável (2.ª execução sem erros)');
  const twoFactor = fs.readFileSync(`${ROOT}/supabase/admin-2fa.sql`, 'utf8');
  await db.exec(twoFactor);
  await db.exec(twoFactor);
  ok('admin-2fa.sql (migração para bases existentes) executa e é re-executável');
  const seed = fs.readFileSync(`${ROOT}/supabase/seed.sql`, 'utf8');
  await db.exec(seed);
  const counts = (await db.query(`select (select count(*) from products)::int p, (select count(*) from product_images)::int i, (select count(*) from product_variants)::int v`)).rows[0];
  assert.deepEqual(counts, { p: 6, i: 10, v: 26 });
  ok(`seed.sql: ${counts.p} produtos, ${counts.i} imagens, ${counts.v} variantes`);

  // Dar preço/stock de teste (como faria o admin)
  await db.exec(`
    update products set base_price = 1250 where slug in ('seven-signature', 't-shirt-seven');
    update products set base_price = 1500 where slug = 'polo-seven';
    update product_variants set stock = 5 where product_id = (select id from products where slug = 'seven-signature');
    update product_variants set stock = 1 where product_id = (select id from products where slug = 'polo-seven') and color = 'Rosa' and size = 'L';
    update product_variants set stock = 0 where product_id = (select id from products where slug = 'polo-seven') and color = 'Rosa' and size = 'XL';
    update product_variants set price_override = 1350 where product_id = (select id from products where slug = 'seven-signature') and size = 'XXL';
    insert into products (slug, name, category, status, base_price) values ('rascunho-secreto', 'Rascunho', 'hoodies', 'draft', 2800);
  `);
  const variant = async (slug, color, size) => (await db.query(`select v.id from product_variants v join products p on p.id = v.product_id where p.slug = $1 and v.color = $2 and v.size is not distinct from $3`, [slug, color, size])).rows[0].id;
  const sigM = await variant('seven-signature', 'Preto', 'M');
  const sigXXL = await variant('seven-signature', 'Preto', 'XXL');
  const poloL = await variant('polo-seven', 'Rosa', 'L');
  const poloXL = await variant('polo-seven', 'Rosa', 'XL');
  const teeUnpriced = await variant('t-shirt-seven', 'Verde', 'M');
  const custom = (await db.query(`select v.id from product_variants v join products p on p.id = v.product_id where p.slug = 'sacola-personalizada'`)).rows[0].id;

  const customer = { name: 'João Mussa', phone: '84 123 4567', location: 'Maputo', delivery_type: 'entrega', notes: "Portão verde & 'casa' #2" };

  async function asRole(role, fn, sub = '', aal = 'aal2') {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [sub ? JSON.stringify({ sub, role, aal }) : '']);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  async function order(items, expected = null, c = customer) {
    return asRole('anon', () => db.query('select * from public.create_order($1::jsonb, $2::jsonb, $3)', [JSON.stringify(c), JSON.stringify(items), expected]));
  }
  async function orderError(items, expected, c) {
    try { await order(items, expected, c); return null; } catch (error) { return error.message; }
  }

  // Sucesso: 2 × 1.250 + 1 × 1.500 = 4.000
  const result = await order([{ variant_id: sigM, quantity: 2 }, { variant_id: poloL, quantity: 1 }], 4000);
  const row = result.rows[0];
  assert.equal(row.total, 4000);
  assert.equal(row.subtotal, 4000);
  assert.match(row.order_number, /^GSL-0001$/);
  ok(`create_order como anon → ${row.order_number}, total ${row.total}`);
  const second = (await order([{ variant_id: sigXXL, quantity: 1 }], 1350)).rows[0];
  assert.equal(second.order_number, 'GSL-0002');
  assert.equal(second.total, 1350);
  ok('sequência GSL-0002 e price_override aplicado no servidor (1.350)');
  const items = (await db.query(`select product_name_snapshot, color_snapshot, size_snapshot, unit_price, quantity, subtotal from order_items where order_id = $1 order by product_name_snapshot`, [row.order_id])).rows;
  assert.deepEqual(items.map(item => [item.product_name_snapshot, item.color_snapshot, item.size_snapshot, item.unit_price, item.quantity, item.subtotal]),
    [['Polo Seven', 'Rosa', 'L', 1500, 1, 1500], ['Seven Signature', 'Preto', 'M', 1250, 2, 2500]]);
  const saved = (await db.query(`select customer_name, phone, location, delivery_type, notes, status from orders where id = $1`, [row.order_id])).rows[0];
  assert.equal(saved.status, 'novo');
  assert.equal(saved.notes, "Portão verde & 'casa' #2");
  ok('snapshots de nome/cor/tamanho/preço guardados; estado novo; observações preservadas');

  // Linhas duplicadas somadas antes da verificação de stock (5 em stock)
  assert.match(await orderError([{ variant_id: sigM, quantity: 3 }, { variant_id: sigM, quantity: 3 }]), /STOCK_INSUFFICIENT/);
  ok('linhas duplicadas não contornam o stock (3 + 3 > 5 → STOCK_INSUFFICIENT)');
  assert.match(await orderError([{ variant_id: poloL, quantity: 2 }]), /STOCK_INSUFFICIENT/);
  assert.match(await orderError([{ variant_id: poloXL, quantity: 1 }]), /STOCK_INSUFFICIENT/);
  ok('stock = 1 bloqueia 2; stock = 0 bloqueia');
  assert.match(await orderError([{ variant_id: sigM, quantity: 1 }], 1), /PRICE_CHANGED/);
  ok('total esperado diferente → PRICE_CHANGED');
  assert.match(await orderError([{ variant_id: teeUnpriced, quantity: 1 }]), /PRODUCT_UNAVAILABLE/);
  ok('variante sem stock definido → PRODUCT_UNAVAILABLE');
  assert.match(await orderError([{ variant_id: custom, quantity: 1 }]), /PRODUCT_UNAVAILABLE/);
  ok('produto de personalização (order_mode custom) → PRODUCT_UNAVAILABLE');
  assert.match(await orderError([]), /EMPTY_ORDER/);
  assert.match(await orderError([{ variant_id: 'nao-e-uuid', quantity: 1 }]), /INVALID_ITEM/);
  assert.match(await orderError([{ variant_id: sigM, quantity: 0 }]), /INVALID_ITEM/);
  assert.match(await orderError([{ variant_id: sigM, quantity: 1.5 }]), /INVALID_ITEM/);
  assert.match(await orderError([{ variant_id: sigM, quantity: -1 }]), /INVALID_ITEM/);
  ok('lista vazia, uuid inválido, quantidade 0/1.5/-1 rejeitados');
  assert.match(await orderError([{ variant_id: sigM, quantity: 1 }], null, { ...customer, name: ' ' }), /INVALID_CUSTOMER/);
  assert.match(await orderError([{ variant_id: sigM, quantity: 1 }], null, { ...customer, phone: '12' }), /INVALID_CUSTOMER/);
  assert.match(await orderError([{ variant_id: sigM, quantity: 1 }], null, { ...customer, location: '' }), /INVALID_CUSTOMER/);
  assert.match(await orderError([{ variant_id: sigM, quantity: 1 }], null, { ...customer, delivery_type: 'drone' }), /INVALID_CUSTOMER/);
  const intl = await order([{ variant_id: sigM, quantity: 1 }], 1250, { ...customer, phone: '0027821234567', delivery_type: 'levantamento', location: '' });
  assert.ok(intl.rows[0].order_number);
  ok('cliente inválido rejeitado; internacional com 00 e levantamento sem localização aceites');

  // RLS e permissões do anon
  const anonProducts = await asRole('anon', () => db.query(`select slug from products`));
  assert.ok(!anonProducts.rows.some(p => p.slug === 'rascunho-secreto'));
  assert.equal(anonProducts.rows.length, 6);
  ok('anon vê só produtos ativos (rascunho escondido)');
  const denied = async sql => asRole('anon', async () => { try { await db.query(sql); return false; } catch { return true; } });
  assert.ok(await denied(`select * from orders`), 'anon não lê pedidos');
  assert.ok(await denied(`insert into orders (customer_name, phone, delivery_type, subtotal, total) values ('x','841234567','levantamento',0,0)`), 'anon não insere pedidos');
  assert.ok(await denied(`update products set base_price = 1`), 'anon não altera produtos');
  assert.ok(await denied(`update product_variants set stock = 999`), 'anon não altera stock');
  assert.ok(await denied(`select * from order_items`), 'anon não lê itens');
  ok('anon não lê/insere pedidos nem altera produtos/stock');
  // update sem permissão pode "passar" sem linhas afetadas com RLS; confirmar que nada mudou
  assert.equal((await db.query(`select stock from product_variants where id = $1`, [sigM])).rows[0].stock, 5);

  // Admin autenticado
  const admin = (await db.query(`insert into auth.users (email) values ('dono@exemplo.com') returning id`)).rows[0].id;
  const other = (await db.query(`insert into auth.users (email) values ('outro@exemplo.com') returning id`)).rows[0].id;
  await db.query(`insert into admin_users (user_id, email) values ($1, 'dono@exemplo.com')`, [admin]);
  const adminOrders = await asRole('authenticated', () => db.query(`select order_number from orders order by order_number`), admin);
  assert.equal(adminOrders.rows.length, 3);
  await asRole('authenticated', () => db.query(`update product_variants set stock = 7 where id = $1`, [sigM]), admin);
  assert.equal((await db.query(`select stock from product_variants where id = $1`, [sigM])).rows[0].stock, 7);
  await asRole('authenticated', () => db.query(`update orders set status = 'confirmado' where order_number = 'GSL-0001'`), admin);
  assert.equal((await db.query(`select status from orders where order_number = 'GSL-0001'`)).rows[0].status, 'confirmado');
  const adminDraft = await asRole('authenticated', () => db.query(`select slug from products where status = 'draft'`), admin);
  assert.equal(adminDraft.rows.length, 1);
  ok('admin lê pedidos, atualiza stock e estado, vê rascunhos');
  const otherOrders = await asRole('authenticated', () => db.query(`select * from orders`), other);
  assert.equal(otherOrders.rows.length, 0);
  await asRole('authenticated', () => db.query(`update product_variants set stock = 0 where id = $1`, [sigM]), other).catch(() => {});
  assert.equal((await db.query(`select stock from product_variants where id = $1`, [sigM])).rows[0].stock, 7);
  assert.ok(await asRole('authenticated', async () => { try { await db.query(`insert into admin_users (user_id, email) values ($1, 'x')`, [other]); return false; } catch { return true; } }, other));
  ok('utilizador autenticado sem admin_users não vê pedidos, não altera stock, não se promove');
  // Verificação em dois passos: o admin só com a palavra-passe (aal1) não tem poderes de administrador
  const onlyPassword = (sql, params = []) => asRole('authenticated', () => db.query(sql, params), admin, 'aal1');
  assert.equal((await onlyPassword('select public.is_admin() as ok')).rows[0].ok, false);
  assert.equal((await asRole('authenticated', () => db.query('select public.is_admin() as ok'), admin)).rows[0].ok, true);
  assert.equal((await onlyPassword('select * from orders')).rows.length, 0);
  assert.equal((await onlyPassword(`select slug from products where status = 'draft'`)).rows.length, 0);
  await onlyPassword(`update product_variants set stock = 0 where id = $1`, [sigM]).catch(() => {});
  assert.equal((await db.query(`select stock from product_variants where id = $1`, [sigM])).rows[0].stock, 7);
  assert.equal((await onlyPassword('select user_id from admin_users')).rows.length, 1, 'continua a poder confirmar que é admin (para pedir o código)');
  assert.ok(await asRole('authenticated', async () => { try { await db.query(`insert into storage.objects (bucket_id, name) values ('product-images', 'products/a/aal1.png')`); return false; } catch { return true; } }, admin, 'aal1'));
  ok('admin sem o código (aal1): is_admin() falso, não vê pedidos nem rascunhos, não altera stock nem carrega imagens');
  const statusInvalid = await asRole('authenticated', async () => { try { await db.query(`update orders set status = 'enviado'`); return false; } catch { return true; } }, admin);
  assert.ok(statusInvalid);
  ok('estado de pedido fora da lista rejeitado');
  // Storage: anon não escreve
  assert.ok(await denied(`insert into storage.objects (bucket_id, name) values ('product-images', 'x.png')`));
  await asRole('authenticated', () => db.query(`insert into storage.objects (bucket_id, name) values ('product-images', 'products/a/x.png')`), admin);
  ok('storage: anon não carrega imagens; admin carrega');
  await db.close();
});
