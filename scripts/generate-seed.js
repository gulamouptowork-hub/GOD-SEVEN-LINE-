// Gera supabase/seed.sql a partir de data/products.json.
//
// Uso:  node scripts/generate-seed.js                 → escreve supabase/seed.sql
//       node scripts/generate-seed.js --output f.sql  → escreve noutro ficheiro
//
// O SQL gerado é idempotente: produtos com upsert por slug; imagens e variantes desses produtos
// são apagadas e inseridas de novo. Preços e stock null ficam null (nada é inventado).
// Também pode ser importado (buildSeedSQL) — usado em tests/seed.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCatalog } from '../js/lib/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INPUT_FILE = path.join(ROOT, 'data', 'products.json');
export const OUTPUT_FILE = path.join(ROOT, 'supabase', 'seed.sql');

const STATUSES = new Set(['active', 'draft', 'archived']);
const ORDER_MODES = new Set(['cart', 'custom']);
const MAX_INT = 2147483647;

// ---------------------------------------------------------------------------
// Literais SQL
// ---------------------------------------------------------------------------

// Texto → literal SQL entre plicas, com as plicas duplicadas ('' ). null/undefined → null.
// (standard_conforming_strings está ativo no Postgres: a barra invertida não é especial.)
export function sqlString(value) {
  if (value === null || value === undefined) return 'null';
  const text = String(value);
  if (text.includes('\u0000')) throw new Error('O Postgres não aceita o carácter nulo (\\u0000) em texto.');
  return `'${text.replaceAll("'", "''")}'`;
}

// Inteiro >= 0 (preços em MZN, stock, posições) ou null.
export function sqlInteger(value, label = 'valor') {
  if (value === null || value === undefined) return 'null';
  if (!Number.isInteger(value) || value < 0 || value > MAX_INT) {
    throw new Error(`${label}: esperado inteiro >= 0 ou null, recebido ${JSON.stringify(value)}.`);
  }
  return String(value);
}

export function sqlBoolean(value) {
  return value ? 'true' : 'false';
}

export function sqlTimestamp(value, label = 'data') {
  if (value === null || value === undefined || value === '') return 'null';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}: data inválida ${JSON.stringify(value)}.`);
  return `${sqlString(date.toISOString())}::timestamptz`;
}

// ---------------------------------------------------------------------------
// data/products.json (camelCase) → linhas das tabelas (snake_case)
// ---------------------------------------------------------------------------

function oneOf(value, allowed, fallback, label) {
  if (value === null || value === undefined) return fallback;
  if (!allowed.has(value)) throw new Error(`${label}: valor desconhecido ${JSON.stringify(value)}.`);
  return value;
}

export function catalogRows(products) {
  const errors = validateCatalog(products);
  if (errors.length) throw new Error(`Catálogo inválido:\n- ${errors.join('\n- ')}`);
  if (!products.length) throw new Error('O catálogo está vazio: nada para gerar.');

  const productRows = [];
  const imageRows = [];
  const variantRows = [];
  const skus = new Set(); // o SKU é único em toda a tabela product_variants

  for (const product of products) {
    const where = `produto "${product.slug}"`;
    if (!String(product.name).trim()) throw new Error(`${where}: nome vazio.`);

    productRows.push({
      slug: product.slug,
      name: String(product.name),
      description: String(product.description ?? ''),
      category: product.category,
      product_type: String(product.productType ?? ''),
      base_price: sqlInteger(product.basePrice, `${where}: basePrice`),
      status: oneOf(product.status, STATUSES, 'draft', `${where}: status`),
      featured: Boolean(product.featured),
      order_mode: oneOf(product.orderMode, ORDER_MODES, 'cart', `${where}: orderMode`),
      tag: product.tag ? String(product.tag) : null,
      created_at: sqlTimestamp(product.createdAt, `${where}: createdAt`)
    });

    product.images.forEach((raw, index) => {
      const image = typeof raw === 'string' ? { src: raw } : raw;
      if (!image?.src || !String(image.src).trim()) throw new Error(`${where}: imagem #${index + 1} sem src.`);
      imageRows.push({
        slug: product.slug,
        image_url: String(image.src),
        alt_text: String(image.alt ?? ''),
        position: sqlInteger(image.position ?? index, `${where}: posição da imagem #${index + 1}`),
        color: String(image.color ?? '').trim() || null
      });
    });

    const options = new Set();
    (product.variants ?? []).forEach((variant, index) => {
      // Mesmas regras de normalizeProduct (js/lib/catalog.js): sem cor → 'Único', tamanho vazio → null.
      const color = String(variant.color ?? '').trim() || 'Único';
      const size = String(variant.size ?? '').trim() || null;
      const sku = String(variant.sku ?? '').trim() || null;
      if (sku && skus.has(sku)) throw new Error(`${where}: variante com SKU repetido (${sku}).`);
      if (sku) skus.add(sku);
      const option = JSON.stringify([color, size]);
      if (options.has(option)) throw new Error(`${where}: variante repetida (${color}, ${size ?? 'tamanho único'}).`);
      options.add(option);
      variantRows.push({
        slug: product.slug,
        color,
        size,
        stock: sqlInteger(variant.stock, `${where}: stock de ${variant.id}`),
        price_override: sqlInteger(variant.priceOverride, `${where}: priceOverride de ${variant.id}`),
        sku,
        position: sqlInteger(variant.position ?? index, `${where}: posição de ${variant.id}`)
      });
    });
  }

  return { productRows, imageRows, variantRows };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const HEADER = `-- =====================================================================
-- God Seven Line — dados iniciais do catálogo (seed)
--
-- FICHEIRO GERADO por scripts/generate-seed.js a partir de data/products.json.
-- Não editar à mão. Para regenerar:  node scripts/generate-seed.js
--
-- Como usar: correr DEPOIS de supabase/schema.sql, no SQL Editor do Supabase.
-- Preços e stock que estão null em data/products.json ficam null ("Preço sob consulta").
--
-- ATENÇÃO: pode ser executado mais do que uma vez, mas cada execução repõe os valores de
-- data/products.json nestes produtos (preço base, estado, descrição…) e APAGA e volta a criar
-- as suas imagens e variantes — o stock e os preços por variante definidos no /admin perdem-se.
-- Depois de começares a gerir o catálogo no /admin, não voltes a correr este ficheiro.
-- =====================================================================`;

const tuple = values => `  (${values.join(', ')})`;
const slugList = rows => rows.map(row => `  ${sqlString(row.slug)}`).join(',\n');

export function buildSeedSQL(products) {
  const { productRows, imageRows, variantRows } = catalogRows(products);
  const slugs = slugList(productRows);
  const inSeedProducts = `select id from public.products where slug in (\n${slugs}\n)`;
  const out = [HEADER, '', 'begin;', ''];

  out.push(
    '-- Produtos: insere ou atualiza pelo slug (created_at existente mantém-se).',
    'insert into public.products as p',
    '  (slug, name, description, category, product_type, base_price, status, featured, order_mode, tag, created_at)',
    'values',
    productRows.map(row => tuple([
      sqlString(row.slug), sqlString(row.name), sqlString(row.description), sqlString(row.category),
      sqlString(row.product_type), row.base_price, sqlString(row.status), sqlBoolean(row.featured),
      sqlString(row.order_mode), sqlString(row.tag), row.created_at
    ])).join(',\n'),
    'on conflict (slug) do update set',
    '  name = excluded.name,',
    '  description = excluded.description,',
    '  category = excluded.category,',
    '  product_type = excluded.product_type,',
    '  base_price = excluded.base_price,',
    '  status = excluded.status,',
    '  featured = excluded.featured,',
    '  order_mode = excluded.order_mode,',
    '  tag = excluded.tag,',
    '  created_at = coalesce(excluded.created_at, p.created_at);',
    ''
  );

  out.push(
    '-- Imagens: apaga as destes produtos e insere as de data/products.json (image_url = chave de assets/images).',
    `delete from public.product_images where product_id in (${inSeedProducts});`,
    ''
  );
  if (imageRows.length) {
    out.push(
      'insert into public.product_images (product_id, image_url, alt_text, position, color)',
      'select p.id, v.image_url, v.alt_text, v.position::integer, v.color::text',
      'from (values',
      imageRows.map(row => tuple([
        sqlString(row.slug), sqlString(row.image_url), sqlString(row.alt_text), row.position, sqlString(row.color)
      ])).join(',\n'),
      ') as v (slug, image_url, alt_text, position, color)',
      'join public.products p on p.slug = v.slug;',
      ''
    );
  }

  out.push(
    '-- Variantes: apaga as destes produtos e insere as de data/products.json (stock/preço null = por definir).',
    `delete from public.product_variants where product_id in (${inSeedProducts});`,
    ''
  );
  if (variantRows.length) {
    out.push(
      'insert into public.product_variants (product_id, color, size, stock, price_override, sku, position)',
      'select p.id, v.color, v.size::text, v.stock::integer, v.price_override::integer, v.sku::text, v.position::integer',
      'from (values',
      variantRows.map(row => tuple([
        sqlString(row.slug), sqlString(row.color), sqlString(row.size), row.stock, row.price_override,
        sqlString(row.sku), row.position
      ])).join(',\n'),
      ') as v (slug, color, size, stock, price_override, sku, position)',
      'join public.products p on p.slug = v.slug;',
      ''
    );
  }

  out.push(
    'commit;',
    '',
    '-- Resumo (aparece como resultado no SQL Editor).',
    'select p.slug, p.status, p.base_price,',
    '       (select count(*) from public.product_images i where i.product_id = p.id) as imagens,',
    '       (select count(*) from public.product_variants v where v.product_id = p.id) as variantes',
    'from public.products p',
    `where p.slug in (\n${slugs}\n)`,
    'order by p.slug;',
    ''
  );

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Execução direta
// ---------------------------------------------------------------------------

export function generateSeed({ input = INPUT_FILE, output = OUTPUT_FILE } = {}) {
  const products = JSON.parse(fs.readFileSync(input, 'utf8'));
  const sql = buildSeedSQL(products);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, sql, 'utf8');
  const { imageRows, variantRows } = catalogRows(products);
  return { output, products: products.length, images: imageRows.length, variants: variantRows.length };
}

function outputFromArgs(argv) {
  const index = argv.findIndex(arg => arg === '--output' || arg.startsWith('--output='));
  if (index === -1) return OUTPUT_FILE;
  const value = argv[index].includes('=') ? argv[index].slice('--output='.length) : argv[index + 1];
  if (!value) throw new Error('Indica o ficheiro depois de --output.');
  return path.resolve(value);
}

// true quando o ficheiro é executado com `node scripts/generate-seed.js` (e não importado).
// Compara URLs file:// (pathToFileURL trata as barras e letras de unidade do Windows).
function isDirectRun() {
  if (!process.argv[1]) return false;
  let entry = path.resolve(process.argv[1]);
  try { entry = fs.realpathSync(entry); } catch { /* ficheiro sem realpath: usa o caminho tal como está */ }
  const entryURL = pathToFileURL(entry).href;
  const selfURL = import.meta.url;
  return process.platform === 'win32' ? entryURL.toLowerCase() === selfURL.toLowerCase() : entryURL === selfURL;
}

if (isDirectRun()) {
  try {
    const result = generateSeed({ output: outputFromArgs(process.argv.slice(2)) });
    console.log(`Seed gerado: ${path.relative(process.cwd(), result.output) || result.output} — ${result.products} produtos, ${result.images} imagens, ${result.variants} variantes.`);
  } catch (error) {
    console.error(`Erro ao gerar o seed: ${error.message}`);
    process.exitCode = 1;
  }
}
