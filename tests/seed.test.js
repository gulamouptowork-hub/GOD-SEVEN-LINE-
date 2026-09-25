import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSeedSQL, catalogRows, sqlInteger, sqlString, sqlTimestamp } from '../scripts/generate-seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realCatalog = () => JSON.parse(fs.readFileSync(path.join(root, 'data', 'products.json'), 'utf8'));

function product(overrides = {}) {
  return {
    id: 'peca-teste',
    slug: 'peca-teste',
    name: 'Peça teste',
    category: 't-shirts',
    productType: 'T-shirt',
    description: '',
    basePrice: null,
    status: 'active',
    featured: false,
    orderMode: 'cart',
    tag: null,
    createdAt: null,
    images: [{ src: 'imagem-teste', alt: 'Imagem de teste' }],
    variants: [{ id: 'peca-teste-preto-m', color: 'Preto', size: 'M', stock: null, priceOverride: null, sku: null }],
    ...overrides
  };
}

// Remove literais '...' (com '' escapado) e comentários -- para verificar a estrutura do SQL.
function stripLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, 'LITERAL').replace(/--[^\n]*/g, '');
}

// Linhas "  (...)" consecutivas do primeiro bloco VALUES depois de `marker`.
function valuesRows(sql, marker) {
  const start = sql.indexOf(marker);
  if (start === -1) return [];
  const lines = sql.slice(start).split('\n');
  const values = lines.findIndex(line => line === 'values' || line === 'from (values');
  if (values === -1) return [];
  const first = values + 1;
  const end = lines.findIndex((line, index) => index > first && !line.startsWith('  ('));
  return lines.slice(first, end === -1 ? undefined : end);
}

test('sqlString duplica plicas e trata null', () => {
  assert.equal(sqlString("D'Ávila"), "'D''Ávila'");
  assert.equal(sqlString("'; drop table public.orders; --"), "'''; drop table public.orders; --'");
  assert.equal(sqlString('sem plicas'), "'sem plicas'");
  assert.equal(sqlString('C:\\pasta'), "'C:\\pasta'", 'barra invertida é literal (standard_conforming_strings)');
  assert.equal(sqlString(null), 'null');
  assert.equal(sqlString(undefined), 'null');
  assert.throws(() => sqlString('a\u0000b'), /nulo/);
});

test('sqlInteger aceita apenas inteiros >= 0 ou null', () => {
  assert.equal(sqlInteger(null), 'null');
  assert.equal(sqlInteger(0), '0');
  assert.equal(sqlInteger(1250), '1250');
  for (const invalid of [-1, 12.5, '100', Number.NaN, Infinity, 2 ** 31]) {
    assert.throws(() => sqlInteger(invalid, 'preço'), /inteiro/, String(invalid));
  }
});

test('sqlTimestamp normaliza datas para ISO e rejeita datas inválidas', () => {
  assert.equal(sqlTimestamp(null), 'null');
  assert.equal(sqlTimestamp('2026-09-01T10:00:00Z'), "'2026-09-01T10:00:00.000Z'::timestamptz");
  assert.throws(() => sqlTimestamp('ontem'), /inválida/);
});

test('o seed do catálogo real inclui todos os produtos, imagens e variantes', () => {
  const products = realCatalog();
  const sql = buildSeedSQL(products);
  const productRows = valuesRows(sql, 'insert into public.products');
  const imageRows = valuesRows(sql, 'insert into public.product_images');
  const variantRows = valuesRows(sql, 'insert into public.product_variants');

  assert.equal(productRows.length, products.length);
  for (const item of products) {
    assert.ok(productRows.some(row => row.startsWith(`  ('${item.slug}', `)), `upsert de ${item.slug}`);
    // Aparece nas duas listas de delete e no resumo final.
    assert.ok(sql.split(`  '${item.slug}'`).length - 1 >= 3, `slug ${item.slug} nas listas de delete/resumo`);
    for (const image of item.images) {
      assert.ok(imageRows.some(row => row.startsWith(`  ('${item.slug}', '${image.src}', `)), `imagem ${image.src} de ${item.slug}`);
    }
  }
  assert.equal(imageRows.length, products.reduce((sum, item) => sum + item.images.length, 0));
  assert.equal(variantRows.length, products.reduce((sum, item) => sum + item.variants.length, 0));
  assert.match(sql, /on conflict \(slug\) do update set/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test('o seed copia preços e stock do catálogo real sem inventar valores (null continua null)', () => {
  const products = realCatalog();
  const { productRows, variantRows } = catalogRows(products);
  const asSQL = value => (value === null || value === undefined ? 'null' : String(value));
  products.forEach((item, index) => {
    assert.equal(productRows[index].base_price, asSQL(item.basePrice), item.slug);
  });
  const variants = products.flatMap(item => item.variants);
  variants.forEach((variant, index) => {
    assert.equal(variantRows[index].stock, asSQL(variant.stock), variant.id);
    assert.equal(variantRows[index].price_override, asSQL(variant.priceOverride), variant.id);
  });
});

test('plicas em nomes, descrições, etiquetas e alt ficam escapadas', () => {
  const sql = buildSeedSQL([product({
    name: "Tee D'Ávila",
    description: "It's a 'test'; drop table public.orders; --",
    tag: "L'EDITION",
    images: [{ src: 'imagem-teste', alt: "Vista d'frente", color: "Verde d'água" }],
    variants: [{ id: 'v1', color: "Verde d'água", size: 'M', stock: null, priceOverride: null, sku: "SKU'1" }]
  })]);
  assert.ok(sql.includes("'Tee D''Ávila'"));
  assert.ok(sql.includes("'It''s a ''test''; drop table public.orders; --'"));
  assert.ok(sql.includes("'L''EDITION'"));
  assert.ok(sql.includes("'Vista d''frente'"));
  assert.ok(sql.includes("'Verde d''água'"));
  assert.ok(sql.includes("'SKU''1'"));

  const structure = stripLiterals(sql);
  assert.ok(!structure.includes("'"), 'sem plicas soltas fora dos literais');
  assert.ok(!/drop table/i.test(structure), 'o texto injetado nunca sai do literal');
  const opens = (structure.match(/\(/g) ?? []).length;
  const closes = (structure.match(/\)/g) ?? []).length;
  assert.equal(opens, closes, 'parênteses equilibrados');
});

test('preços, stock e datas definidos passam tal como estão', () => {
  const sql = buildSeedSQL([product({
    basePrice: 1250,
    createdAt: '2026-09-01T10:00:00Z',
    variants: [
      { id: 'a', color: 'Preto', size: 'M', stock: 4, priceOverride: 1500, sku: 'GSL-TEE-PM' },
      { id: 'b', color: 'Preto', size: 'L', stock: 0, priceOverride: null, sku: null }
    ]
  })]);
  assert.match(sql, /\('peca-teste', 'Peça teste', '', 't-shirts', 'T-shirt', 1250, 'active', false, 'cart', null, '2026-09-01T10:00:00\.000Z'::timestamptz\)/);
  assert.ok(sql.includes("  ('peca-teste', 'Preto', 'M', 4, 1500, 'GSL-TEE-PM', 0)"));
  assert.ok(sql.includes("  ('peca-teste', 'Preto', 'L', 0, null, null, 1)"));
});

test('tamanho vazio passa a null e cor em falta passa a "Único" (como normalizeProduct)', () => {
  const sql = buildSeedSQL([product({ variants: [{ id: 'u', color: '', size: '', stock: null, priceOverride: null, sku: null }] })]);
  assert.ok(sql.includes("  ('peca-teste', 'Único', null, null, null, null, 0)"));
});

test('produtos sem variantes: são limpos mas não geram insert vazio', () => {
  const sql = buildSeedSQL([product({ orderMode: 'custom', variants: [] })]);
  assert.match(sql, /delete from public\.product_variants/);
  assert.ok(!sql.includes('insert into public.product_variants'));
  assert.ok(sql.includes('insert into public.product_images'));
});

test('dados inválidos são rejeitados antes de gerar SQL', () => {
  assert.throws(() => buildSeedSQL([]), /vazio/);
  assert.throws(() => buildSeedSQL([product({ basePrice: 12.5 })]), /basePrice/);
  assert.throws(() => buildSeedSQL([product({ basePrice: -1 })]), /preço base inválido/);
  assert.throws(() => buildSeedSQL([product({ category: 'sapatos' })]), /categoria desconhecida/);
  assert.throws(() => buildSeedSQL([product({ slug: "peca'teste" })]), /slug inválido/);
  assert.throws(() => buildSeedSQL([product({ status: 'publicado' })]), /status/);
  assert.throws(() => buildSeedSQL([product({ orderMode: 'loja' })]), /orderMode/);
  assert.throws(() => buildSeedSQL([product({
    variants: [
      { id: 'a', color: 'Preto', size: 'M', stock: 1 },
      { id: 'b', color: 'Preto', size: 'M', stock: 2 }
    ]
  })]), /repetida/);
  assert.throws(() => buildSeedSQL([product({ variants: [{ id: 'a', color: 'Preto', size: 'M', stock: 1.5 }] })]), /stock inválido/);
});

test('o resultado é determinístico', () => {
  assert.equal(buildSeedSQL(realCatalog()), buildSeedSQL(realCatalog()));
});

test('supabase/seed.sql está atualizado com data/products.json (senão: node scripts/generate-seed.js)', () => {
  const onDisk = fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk, buildSeedSQL(realCatalog()));
});

test('o script corre diretamente (node scripts/generate-seed.js --output …)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-seed-'));
  try {
    const output = path.join(dir, 'seed.sql');
    const stdout = execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-seed.js'), '--output', output], { encoding: 'utf8' });
    assert.match(stdout, /Seed gerado/);
    assert.equal(fs.readFileSync(output, 'utf8'), buildSeedSQL(realCatalog()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Instruções `create policy … on storage.objects …;` de supabase/schema.sql (sem comentários).
function storagePolicies() {
  const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
  return schema.split(';')
    .map(statement => statement.replace(/\s+/g, ' ').trim())
    .filter(statement => /^create policy "[^"]+" on storage\.objects /i.test(statement))
    .map(statement => ({
      name: statement.match(/^create policy "([^"]+)"/i)[1],
      command: statement.match(/ for (\w+) /i)[1].toLowerCase(),
      roles: statement.match(/ to ([\w, ]+?) (?:using|with check) /i)[1].split(',').map(role => role.trim()),
      statement
    }));
}

test('storage: o bucket product-images não é listável por anon (só admins leem pela API)', () => {
  const policies = storagePolicies();
  assert.ok(policies.length >= 4, 'políticas de storage encontradas');
  for (const policy of policies) {
    assert.ok(!policy.roles.includes('anon') && !policy.roles.includes('public'), `${policy.name} não pode abranger anon/public`);
    assert.match(policy.statement, /bucket_id = 'product-images'/, `${policy.name} limitada ao bucket`);
    assert.match(policy.statement, /\(select public\.is_admin\(\)\)/, `${policy.name} exige is_admin()`);
  }
  assert.deepEqual([...new Set(policies.map(policy => policy.command))].sort(), ['delete', 'insert', 'select', 'update']);
  const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
  assert.match(schema, /drop policy if exists "gsl_product_images_public_read" on storage\.objects;/, 'política antiga de leitura pública é removida ao voltar a correr');
});
