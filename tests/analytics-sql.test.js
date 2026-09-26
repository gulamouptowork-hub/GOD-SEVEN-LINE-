// Valida supabase/analytics.sql num Postgres real (PGlite): track_events (validação, limites),
// permissões (anon só escreve pela função; só admin lê o relatório) e analytics_report
// (fuso Africa/Maputo, agrupamento por hora/dia/semana/mês, período anterior, tops e funil).
// Opcional: corre só se o PGlite estiver instalado →  npm i --no-save @electric-sql/pglite && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opcional */ }
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const V3 = '33333333-3333-4333-8333-333333333333';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('supabase: analytics.sql — recolha, permissões e relatório', { skip: PGlite ? false : 'PGlite não instalado (npm i --no-save @electric-sql/pglite)', timeout: 240000 }, async t => {
  const db = new PGlite();
  const ok = message => t.diagnostic(message);

  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(`${ROOT}/supabase/schema.sql`, 'utf8'));
  await db.exec(fs.readFileSync(`${ROOT}/supabase/seed.sql`, 'utf8'));
  const analytics = fs.readFileSync(`${ROOT}/supabase/analytics.sql`, 'utf8');
  await db.exec(analytics);
  await db.exec(analytics);
  ok('analytics.sql executa depois de schema.sql e é re-executável');

  async function asRole(role, fn, sub = '') {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  const failure = async fn => { try { await fn(); return null; } catch (error) { return error.message; } };
  const track = (events, role = 'anon') => asRole(role, async () => (await db.query('select public.track_events($1::jsonb) as saved', [JSON.stringify(events)])).rows[0].saved);
  const base = { visitor_id: V1, session_id: S1, device: 'mobile' };

  // ── track_events: validação ──
  const saved = await track([
    { ...base, event: 'page_view', path: '/produtos', referrer: 'instagram.com' },
    { ...base, event: 'view_product', path: '/produtos/polo-seven', product_slug: 'polo-seven' },
    { ...base, event: 'evento_inventado', path: '/' },
    { ...base, event: 'page_view', visitor_id: 'não-é-uuid' },
    'texto solto',
    { ...base, event: 'page_view', path: 'http://fora.com/x', product_slug: 'Polo Seven!', referrer: 'a b', device: 'frigorífico' },
    { ...base, event: 'page_view', path: `/${'x'.repeat(250)}` }
  ]);
  assert.equal(saved, 4);
  const rows = (await db.query('select event, path, product_slug, referrer, device from analytics_events order by id')).rows;
  assert.deepEqual(rows.map(r => [r.event, r.path, r.product_slug, r.referrer, r.device]), [
    ['page_view', '/produtos', null, 'instagram.com', 'mobile'],
    ['view_product', '/produtos/polo-seven', 'polo-seven', null, 'mobile'],
    ['page_view', null, null, null, null],
    ['page_view', null, null, null, 'mobile']
  ]);
  ok('eventos inválidos ignorados; campos inválidos gravados como null; evento/uuid inválidos descartados');

  assert.equal(await track({ event: 'page_view' }), 0);
  assert.equal(await track(null), 0);
  assert.equal(await track(Array.from({ length: 40 }, () => ({ ...base, visitor_id: V2, session_id: S2, event: 'page_view', path: '/' }))), 25);
  ok('não-lista → 0; no máximo 25 eventos por chamada');

  let total = 0;
  for (let i = 0; i < 6; i++) total += await track(Array.from({ length: 25 }, () => ({ ...base, visitor_id: V3, session_id: S3, event: 'page_view', path: '/' })));
  assert.equal(total, 120);
  ok('limite: 120 eventos por visitante em 10 minutos');

  // ── Permissões ──
  assert.match(await failure(() => asRole('anon', () => db.query('select * from analytics_events'))), /permission denied/);
  assert.match(await failure(() => asRole('anon', () => db.query(`insert into analytics_events (event, visitor_id, session_id) values ('page_view', '${V1}', '${S1}')`))), /permission denied/);
  assert.match(await failure(() => asRole('anon', () => db.query(`select public.analytics_report('2024-01-01', '2024-01-07')`))), /permission denied/);
  assert.match(await failure(() => asRole('anon', () => db.query(`select public.analytics_totals(now(), now())`))), /permission denied/);
  ok('anon: não lê nem insere na tabela; sem acesso ao relatório nem a analytics_totals');

  const admin = (await db.query(`insert into auth.users (email) values ('dono@exemplo.com') returning id`)).rows[0].id;
  const other = (await db.query(`insert into auth.users (email) values ('outro@exemplo.com') returning id`)).rows[0].id;
  await db.query(`insert into admin_users (user_id, email) values ($1, 'dono@exemplo.com')`, [admin]);
  assert.match(await failure(() => asRole('authenticated', () => db.query(`select public.analytics_report('2024-01-01', '2024-01-07')`), other)), /FORBIDDEN/);
  assert.match(await failure(() => asRole('authenticated', () => db.query('select * from analytics_events'), admin)), /permission denied/);
  ok('conta autenticada sem admin_users → FORBIDDEN; nem o admin lê a tabela diretamente');

  const report = async (from, to, bucket = 'day', tz = 'Africa/Maputo') => asRole('authenticated',
    async () => (await db.query('select public.analytics_report($1::date, $2::date, $3, $4) as r', [from, to, bucket, tz])).rows[0].r, admin);
  const reportError = (...args) => failure(() => report(...args));
  assert.match(await reportError('2024-01-07', '2024-01-01'), /INVALID_PERIOD/);
  assert.match(await reportError('2022-01-01', '2024-01-01'), /INVALID_PERIOD/);
  assert.match(await reportError('2024-01-01', '2024-01-07', 'year'), /INVALID_BUCKET/);
  assert.match(await reportError('2024-01-01', '2024-01-07', 'day', 'Marte/Olympus'), /INVALID_TIMEZONE/);
  ok('período, agrupamento e fuso inválidos são recusados');

  // ── Relatório: dados conhecidos em março de 2024 (horas em UTC; Maputo = UTC+2, sem hora de verão) ──
  await db.exec('delete from analytics_events');
  const ev = (at, event, visitor, session, extra = {}) => ({ at, event, visitor, session, ...extra });
  const events = [
    // Seg. 4/3: V1 (telemóvel, Instagram) vê a coleção e o polo, adiciona, finaliza e envia
    ev('2024-03-04T08:00:00Z', 'page_view', V1, S1, { path: '/produtos', referrer: 'instagram.com', device: 'mobile' }),
    ev('2024-03-04T08:01:00Z', 'page_view', V1, S1, { path: '/produtos/polo-seven', device: 'mobile' }),
    ev('2024-03-04T08:01:05Z', 'view_product', V1, S1, { path: '/produtos/polo-seven', slug: 'polo-seven', device: 'mobile' }),
    ev('2024-03-04T08:02:00Z', 'add_to_cart', V1, S1, { path: '/produtos/polo-seven', slug: 'polo-seven', device: 'mobile' }),
    ev('2024-03-04T08:03:00Z', 'begin_checkout', V1, S1, { path: '/finalizar', device: 'mobile' }),
    ev('2024-03-04T08:05:00Z', 'whatsapp_checkout', V1, S1, { path: '/finalizar', device: 'mobile' }),
    // Seg. 4/3 às 23:30 em Maputo (21:30Z): ainda conta no dia 4
    ev('2024-03-04T21:30:00Z', 'page_view', V2, S2, { path: '/', device: 'desktop' }),
    // Ter. 5/3 às 00:30 em Maputo (22:30Z do dia 4): conta no dia 5
    ev('2024-03-04T22:30:00Z', 'page_view', V2, S2, { path: '/produtos/seven-signature', device: 'desktop' }),
    ev('2024-03-04T22:30:10Z', 'view_product', V2, S2, { path: '/produtos/seven-signature', slug: 'seven-signature', device: 'desktop' }),
    // Dom. 10/3: V3 (tablet, direto) vê dois produtos, pergunta pelo WhatsApp num
    ev('2024-03-10T12:00:00Z', 'page_view', V3, S3, { path: '/produtos/polo-seven', device: 'tablet' }),
    ev('2024-03-10T12:00:05Z', 'view_product', V3, S3, { path: '/produtos/polo-seven', slug: 'polo-seven', device: 'tablet' }),
    ev('2024-03-10T12:02:00Z', 'view_product', V3, S3, { path: '/produtos/produto-apagado', slug: 'produto-apagado', device: 'tablet' }),
    ev('2024-03-10T12:03:00Z', 'whatsapp_click', V3, S3, { path: '/produtos/produto-apagado', slug: 'produto-apagado', device: 'tablet' }),
    // Semana anterior (26/2 a 3/3): 1 visitante — é o "período anterior" de 4 a 10/3
    ev('2024-02-28T10:00:00Z', 'page_view', V1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { path: '/', device: 'mobile' }),
    // Fora de todos os períodos testados
    ev('2024-05-01T10:00:00Z', 'page_view', V2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', { path: '/', device: 'desktop' })
  ];
  for (const e of events) {
    await db.query('insert into analytics_events (created_at, event, visitor_id, session_id, path, product_slug, referrer, device) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [e.at, e.event, e.visitor, e.session, e.path ?? null, e.slug ?? null, e.referrer ?? null, e.device ?? null]);
  }
  await db.query(`insert into orders (customer_name, phone, delivery_type, subtotal, total, status, created_at) values
    ('Cliente A', '841234567', 'entrega', 1500, 1500, 'novo', '2024-03-04T08:05:00Z'),
    ('Cliente B', '841234568', 'entrega', 1500, 1500, 'cancelado', '2024-03-05T08:05:00Z')`);

  const week = await report('2024-03-04', '2024-03-10');
  assert.equal(week.series.length, 7);
  assert.deepEqual(week.series.map(s => s.bucket), ['2024-03-04T00:00', '2024-03-05T00:00', '2024-03-06T00:00', '2024-03-07T00:00', '2024-03-08T00:00', '2024-03-09T00:00', '2024-03-10T00:00']);
  assert.deepEqual(week.series.map(s => s.visitors), [2, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(week.series.map(s => s.page_views), [3, 1, 0, 0, 0, 0, 1]);
  ok('dias em hora de Maputo: 23:30 conta no próprio dia, 00:30 no seguinte; dias sem visitas = 0');

  assert.equal(week.totals.visitors, 3);
  assert.equal(week.totals.sessions, 3);
  assert.equal(week.totals.page_views, 5);
  assert.equal(week.totals.product_views, 4);
  assert.equal(week.totals.add_to_cart, 1);
  assert.equal(week.totals.whatsapp_orders, 1);
  assert.equal(week.totals.whatsapp_clicks, 1);
  assert.equal(week.totals.orders_registered, 1, 'pedidos cancelados não contam');
  assert.deepEqual(week.totals.funnel, { visitors: 3, viewed_product: 3, added_to_cart: 1, began_checkout: 1, sent_order: 1 });
  assert.equal(week.previous.visitors, 1);
  assert.equal(week.previous.page_views, 1);
  ok('totais, funil (visitantes distintos por etapa) e período anterior de igual duração');

  assert.deepEqual(week.top_products.map(p => [p.slug, p.name, p.views, p.visitors, p.adds, p.whatsapp]), [
    ['polo-seven', 'Polo Seven', 2, 2, 1, 0],
    ['produto-apagado', null, 1, 1, 0, 1],
    ['seven-signature', 'Seven Signature', 1, 1, 0, 0]
  ]);
  assert.ok(week.top_products[0].product_id, 'produto existente traz o id para o link do painel');
  assert.deepEqual(week.top_pages[0], { path: '/produtos/polo-seven', views: 2, visitors: 2 });
  assert.deepEqual(week.sources, [{ source: '', sessions: 2 }, { source: 'instagram.com', sessions: 1 }]);
  assert.deepEqual(week.devices.map(d => [d.device, d.visitors]), [['desktop', 1], ['mobile', 1], ['tablet', 1]]);
  assert.equal(week.hours.length, 24);
  assert.equal(week.hours.find(h => h.hour === 10).page_views, 2, '08:00Z = 10h em Maputo');
  assert.equal(week.hours.find(h => h.hour === 23).page_views, 1);
  assert.equal(week.hours.find(h => h.hour === 0).page_views, 1);
  ok('produtos mais vistos (com nome; apagados sem nome), páginas, origem por sessão, dispositivos e horas locais');

  const weeks = await report('2024-02-26', '2024-03-10', 'week');
  assert.deepEqual(weeks.series.map(s => [s.bucket, s.visitors]), [['2024-02-26T00:00', 1], ['2024-03-04T00:00', 3]]);
  const months = await report('2024-02-01', '2024-03-31', 'month');
  assert.deepEqual(months.series.map(s => [s.bucket, s.page_views]), [['2024-02-01T00:00', 1], ['2024-03-01T00:00', 5]]);
  const hours = await report('2024-03-04', '2024-03-04', 'hour');
  assert.equal(hours.series.length, 24);
  assert.equal(hours.series.find(s => s.bucket === '2024-03-04T10:00').page_views, 2);
  assert.equal(hours.series.find(s => s.bucket === '2024-03-04T23:00').page_views, 1);
  ok('semanas começam à segunda; meses e horas agrupados no fuso local');

  const utc = await report('2024-03-04', '2024-03-04', 'day', 'UTC');
  assert.equal(utc.totals.page_views, 4, 'em UTC o evento das 22:30Z pertence ao dia 4');
  assert.ok(week.first_event_at);
  assert.equal(typeof week.live_visitors, 'number');
  ok('o fuso é um parâmetro; first_event_at e live_visitors presentes');
});
