// Lógica pura do painel /admin (sem DOM, sem supabase). Testada em tests/admin.test.js.
// Os imports são RELATIVOS para funcionar tanto em Node como no browser (/admin/js/ → /js/lib/, /config/).
import { SITE_CONFIG, categoryLabel, deliveryOption, orderStatusLabel } from '../../config/site.js';
import { formatPrice } from '../../js/lib/format.js';
import { normalizeSearch, slugify } from '../../js/lib/html.js';
import { IMAGE_MANIFEST } from '../../js/lib/image-manifest.js';
import { formatPhone, whatsappDigits } from '../../js/lib/validation.js';
import { buildWhatsAppURL } from '../../js/lib/whatsapp.js';

// ─── Constantes ──────────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = Object.freeze([
  Object.freeze({ id: 'active', label: 'Ativo' }),
  Object.freeze({ id: 'draft', label: 'Rascunho' }),
  Object.freeze({ id: 'archived', label: 'Arquivado' })
]);

export const ORDER_MODES = Object.freeze([
  Object.freeze({ id: 'cart', label: 'Pedido normal' }),
  Object.freeze({ id: 'custom', label: 'Personalização via WhatsApp' })
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ORDERS_PAGE_SIZE = 25;
export const NO_SIZE_LABEL = 'Único';
export const MAX_WHOLE_NUMBER = 1_000_000_000;

export const LIMITS = Object.freeze({
  name: 120, slug: 120, productType: 60, description: 4000, tag: 30,
  alt: 200, color: 40, size: 20, sku: 64, url: 2000
});

export const UPLOAD = Object.freeze({
  bucket: 'product-images',
  maxBytes: 5 * 1024 * 1024,
  types: Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })
});

// Tamanhos criados pelo atalho "Gerar tamanhos" (S…XXL, na ordem da configuração central).
export const QUICK_SIZES = Object.freeze(SITE_CONFIG.sizes.slice(
  Math.max(0, SITE_CONFIG.sizes.indexOf('S')),
  SITE_CONFIG.sizes.includes('XXL') ? SITE_CONFIG.sizes.indexOf('XXL') + 1 : SITE_CONFIG.sizes.length
));

// Campos sincronizados por linha (nomes das colunas na base de dados).
export const IMAGE_FIELDS = Object.freeze(['image_url', 'alt_text', 'color', 'position']);
export const VARIANT_FIELDS = Object.freeze(['color', 'size', 'stock', 'price_override', 'sku', 'position']);

const STATUS_IDS = new Set(PRODUCT_STATUSES.map(status => status.id));
const ORDER_MODE_IDS = new Set(ORDER_MODES.map(mode => mode.id));
const ORDER_STATUS_IDS = new Set(SITE_CONFIG.orderStatuses.map(status => status.id));

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const byPosition = (a, b) => (a?.position ?? 0) - (b?.position ?? 0);

export const productStatusLabel = id => PRODUCT_STATUSES.find(status => status.id === id)?.label ?? String(id ?? '');
export const orderModeLabel = id => ORDER_MODES.find(mode => mode.id === id)?.label ?? String(id ?? '');
export const isUuid = value => UUID_PATTERN.test(String(value ?? ''));
export const isOrderStatus = value => ORDER_STATUS_IDS.has(value);

// UUID v4 com crypto.getRandomValues (funciona também fora de contextos seguros, ao contrário de randomUUID).
export function uuid(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Chaves locais estáveis para linhas do formulário (não são ids da base de dados).
export function createKeyFactory(prefix = 'k') {
  let counter = 0;
  return () => `${prefix}${++counter}`;
}

// ─── Rotas (hash) ────────────────────────────────────────────────────────────
// #/ · #/produtos · #/produtos/novo · #/produtos/<id> · #/stock · #/pedidos · #/pedidos/<id>
// Aceita parâmetros opcionais: #/pedidos?estado=novo · #/stock?filtro=low · #/produtos?estado=active

export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  const parts = pathPart.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const route = (name, section, extra = {}) => ({ name, section, query, ...extra });
  if (!parts.length) return route('dashboard', 'dashboard');
  const [head, id, ...rest] = parts;
  if (rest.length) return route('not-found', null);
  if (head === 'produtos') {
    if (!id) return route('products', 'produtos');
    return id === 'novo' ? route('product-new', 'produtos') : route('product-edit', 'produtos', { id });
  }
  if (head === 'pedidos') return id ? route('order-detail', 'pedidos', { id }) : route('orders', 'pedidos');
  if (head === 'stock' && !id) return route('stock', 'stock');
  return route('not-found', null);
}

// ─── Números ─────────────────────────────────────────────────────────────────
// Inteiro >= 0 ou vazio (null). Aceita "1250", "1 250" e "1.250" (separador de milhares).

export function parseWholeNumber(input) {
  const compact = String(input ?? '').replace(/\s+/g, '');
  if (!compact) return { ok: true, value: null };
  let digits = null;
  if (/^\d+$/.test(compact)) digits = compact;
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) digits = compact.replace(/\./g, '');
  if (digits === null) {
    if (/^-\s*\d/.test(compact)) return { ok: false, error: 'Não pode ser negativo.' };
    if (/^\d*[.,]\d+$/.test(compact)) return { ok: false, error: 'Usa um número inteiro, sem casas decimais.' };
    return { ok: false, error: 'Usa apenas algarismos (ex.: 1250).' };
  }
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value > MAX_WHOLE_NUMBER) return { ok: false, error: 'Valor demasiado alto.' };
  return { ok: true, value };
}

const numberToInput = value => (Number.isInteger(value) ? String(value) : '');

// ─── Stock ───────────────────────────────────────────────────────────────────

export const STOCK_STATUSES = Object.freeze([
  Object.freeze({ id: 'in', label: 'EM STOCK' }),
  Object.freeze({ id: 'low', label: 'STOCK BAIXO' }),
  Object.freeze({ id: 'out', label: 'ESGOTADO' }),
  Object.freeze({ id: 'unknown', label: 'POR DEFINIR' })
]);

// 'unknown' (null) | 'out' (0) | 'low' (1..limite) | 'in' (> limite). Só olha para o stock, não para o preço.
export function stockStatus(stock, threshold = SITE_CONFIG.lowStockThreshold) {
  if (!Number.isInteger(stock) || stock < 0) return 'unknown';
  if (stock === 0) return 'out';
  return stock <= threshold ? 'low' : 'in';
}

export const stockStatusLabel = id => STOCK_STATUSES.find(status => status.id === id)?.label ?? '';

// Soma do stock conhecido. { total, known, unknown, count }
export function totalStock(variants = []) {
  let total = 0;
  let known = 0;
  for (const variant of variants) {
    if (Number.isInteger(variant?.stock) && variant.stock >= 0) {
      total += variant.stock;
      known += 1;
    }
  }
  return { total, known, unknown: variants.length - known, count: variants.length };
}

export function stockSummaryLabel(summary) {
  if (!summary?.count) return 'Sem variantes';
  if (!summary.known) return 'Por definir';
  return summary.unknown ? `${summary.total} (+${summary.unknown} por definir)` : String(summary.total);
}

// Contagens do dashboard a partir de variantes { stock }.
export function summarizeVariantStock(variants = []) {
  const counts = { in: 0, low: 0, out: 0, unknown: 0, total: variants.length };
  for (const variant of variants) counts[stockStatus(variant?.stock)] += 1;
  return counts;
}

// +1 / -1 a partir do texto do campo. "Por definir" (vazio) +1 → 1, -1 → 0. Nunca abaixo de 0.
export function stepStock(raw, delta) {
  const parsed = parseWholeNumber(raw);
  const base = parsed.ok && parsed.value !== null ? parsed.value : 0;
  return Math.min(MAX_WHOLE_NUMBER, Math.max(0, base + delta));
}

const sizeRank = size => {
  if (size === null || size === undefined || size === '') return -1;
  const index = SITE_CONFIG.sizes.indexOf(size);
  return index === -1 ? SITE_CONFIG.sizes.length : index;
};

export function compareSizes(a, b) {
  return sizeRank(a) - sizeRank(b) || String(a ?? '').localeCompare(String(b ?? ''), 'pt');
}

export const sizeLabel = size => (size ? String(size) : NO_SIZE_LABEL);

// Produtos (com product_variants) → [{ id, name, status, colors: [{ color, variants: [{ id, size, stock }] }] }]
export function buildStockGroups(products = []) {
  return products.map(product => {
    const variants = [...(product.product_variants ?? [])].sort(byPosition);
    const colors = [];
    for (const variant of variants) {
      const color = variant.color || NO_SIZE_LABEL;
      let entry = colors.find(item => item.color === color);
      if (!entry) colors.push(entry = { color, variants: [] });
      entry.variants.push({
        id: String(variant.id),
        size: variant.size ?? null,
        stock: Number.isInteger(variant.stock) ? variant.stock : null
      });
    }
    for (const entry of colors) entry.variants.sort((a, b) => compareSizes(a.size, b.size));
    return { id: String(product.id), name: String(product.name ?? ''), status: product.status, colors };
  }).filter(group => group.colors.length);
}

// filter: 'all' | 'in' | 'low' | 'out' | 'unknown'. stockOf(variant) permite usar os valores editados.
export function filterStockGroups(groups, { filter = 'all', q = '' } = {}, stockOf = variant => variant.stock) {
  const tokens = normalizeSearch(q).split(/\s+/).filter(Boolean);
  const matches = text => tokens.every(token => normalizeSearch(text).includes(token));
  return groups.map(group => {
    const colors = group.colors.map(entry => {
      if (tokens.length && !matches(`${group.name} ${entry.color}`)) return null;
      const variants = filter === 'all' ? entry.variants : entry.variants.filter(variant => stockStatus(stockOf(variant)) === filter);
      return variants.length ? { ...entry, variants } : null;
    }).filter(Boolean);
    return colors.length ? { ...group, colors } : null;
  }).filter(Boolean);
}

// Seguimento de alterações do stock. original: { id: stock|null }, raw: { id: texto escrito }.
// Devolve só as alterações válidas e diferentes do valor guardado, e os campos inválidos.
export function collectStockEdits(original, raw) {
  const changes = [];
  const invalid = [];
  for (const [id, text] of Object.entries(raw)) {
    if (!Object.hasOwn(original, id)) continue;
    const parsed = parseWholeNumber(text);
    if (!parsed.ok) invalid.push({ id, error: parsed.error });
    else if (parsed.value !== original[id]) changes.push({ id, stock: parsed.value });
  }
  return { changes, invalid, dirty: changes.length > 0 || invalid.length > 0 };
}

// ─── Produtos: lista ─────────────────────────────────────────────────────────

export function productListRow(row) {
  const images = [...(row.product_images ?? [])].sort(byPosition);
  const stock = totalStock(row.product_variants ?? []);
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    category: row.category ?? '',
    categoryLabel: categoryLabel(row.category),
    basePrice: row.base_price ?? null,
    priceLabel: formatPrice(row.base_price, 'Sem preço'),
    status: row.status,
    statusLabel: productStatusLabel(row.status),
    featured: Boolean(row.featured),
    thumb: images[0]?.image_url ?? null,
    stock,
    stockLabel: stockSummaryLabel(stock),
    searchText: normalizeSearch([row.name, row.slug, row.product_type, row.tag, categoryLabel(row.category)].filter(Boolean).join(' '))
  };
}

// Textos de "apagar produto", partilhados pela lista e pelo editor.
export function productDeleteConfirmation(name) {
  const label = String(name ?? '').trim() || 'este produto';
  return `Apagar definitivamente “${label}”?\n\n`
    + 'As imagens e variantes deste produto também serão apagadas. O histórico de pedidos mantém-se: '
    + 'cada pedido guarda uma cópia do nome, cor, tamanho e preço no momento da compra.\n\n'
    + 'Se só queres retirá-lo da loja, abre o produto e usa “Arquivar”.';
}

export const STORAGE_CLEANUP_NOTE = ' Os ficheiros de imagem no Storage não foram removidos (podes apagá-los no painel do Supabase).';

export function filterProductRows(rows, { q = '', category = '', status = '' } = {}) {
  const tokens = normalizeSearch(q).split(/\s+/).filter(Boolean);
  return rows.filter(row => (!category || row.category === category)
    && (!status || row.status === status)
    && tokens.every(token => row.searchText.includes(token)));
}

// ─── Produtos: formulário ────────────────────────────────────────────────────

export function emptyProductForm(id = uuid()) {
  return {
    id, isNew: true, name: '', slug: '', slugTouched: false, category: '', productType: '', description: '',
    basePrice: '', status: 'draft', featured: false, orderMode: 'cart', tag: '', images: [], variants: []
  };
}

export function newImageEntry(key, { src = '', alt = '', color = '' } = {}) {
  return { key, id: null, src, alt, color };
}

export function newVariantEntry(key, { color = '', size = '', stock = '', priceOverride = '', sku = '' } = {}) {
  return { key, id: null, color, size, stock, priceOverride, sku };
}

// Linhas da base de dados → estado de referência (mesma forma que validateImages/validateVariants produzem).
export function imageRowsFromDb(rows = []) {
  return [...rows].sort(byPosition).map((row, index) => ({
    id: String(row.id),
    image_url: String(row.image_url ?? ''),
    alt_text: row.alt_text ?? '',
    color: row.color || null,
    position: Number.isInteger(row.position) ? row.position : index
  }));
}

export function variantRowsFromDb(rows = []) {
  return [...rows].sort(byPosition).map((row, index) => ({
    id: String(row.id),
    color: String(row.color ?? ''),
    size: row.size || null,
    stock: Number.isInteger(row.stock) ? row.stock : null,
    price_override: Number.isInteger(row.price_override) ? row.price_override : null,
    sku: row.sku || null,
    position: Number.isInteger(row.position) ? row.position : index
  }));
}

// Produto da base de dados (com product_images e product_variants) → estado do formulário (texto nos campos).
export function productFormFromDb(row, makeKey = createKeyFactory()) {
  return {
    id: String(row.id),
    isNew: false,
    name: row.name ?? '',
    slug: row.slug ?? '',
    slugTouched: true, // produtos existentes: nunca mudar o slug (e o URL público) automaticamente
    category: row.category ?? '',
    productType: row.product_type ?? '',
    description: row.description ?? '',
    basePrice: numberToInput(row.base_price),
    status: STATUS_IDS.has(row.status) ? row.status : 'draft',
    featured: Boolean(row.featured),
    orderMode: ORDER_MODE_IDS.has(row.order_mode) ? row.order_mode : 'cart',
    tag: row.tag ?? '',
    images: imageRowsFromDb(row.product_images).map(image => ({
      key: makeKey(), id: image.id, src: image.image_url, alt: image.alt_text ?? '', color: image.color ?? ''
    })),
    variants: variantRowsFromDb(row.product_variants).map(variant => ({
      key: makeKey(), id: variant.id, color: variant.color, size: variant.size ?? '',
      stock: numberToInput(variant.stock), priceOverride: numberToInput(variant.price_override), sku: variant.sku ?? ''
    }))
  };
}

// Slug gerado a partir do nome enquanto o utilizador não o editar à mão.
export function applyNameChange(form, name) {
  return { ...form, name, slug: form.slugTouched ? form.slug : slugify(name).slice(0, LIMITS.slug).replace(/-+$/, '') };
}

export function applySlugChange(form, slug) {
  const value = String(slug ?? '');
  return { ...form, slug: value, slugTouched: value.trim() !== '' };
}

// Representação estável do conteúdo do formulário para detetar alterações por guardar.
// Não inclui ids: gravar uma linha nova (que passa a ter id) não a torna "alterada".
export function formSnapshot(form) {
  return JSON.stringify({
    name: form.name, slug: form.slug, category: form.category, productType: form.productType,
    description: form.description, basePrice: form.basePrice, status: form.status, featured: Boolean(form.featured),
    orderMode: form.orderMode, tag: form.tag,
    images: form.images.map(({ src, alt, color }) => [src, alt, color]),
    variants: form.variants.map(({ color, size, stock, priceOverride, sku }) => [color, size, stock, priceOverride, sku])
  });
}

const tooLong = (value, max) => value.length > max ? `Usa no máximo ${max} caracteres.` : null;

// Campos principais. Devolve { valid, errors: { campo: mensagem }, value: linha snake_case para products }.
export function validateProductForm(form) {
  const errors = {};
  const name = clean(form.name);
  const slug = String(form.slug ?? '').trim();
  const productType = clean(form.productType);
  const description = String(form.description ?? '').trim();
  const tag = clean(form.tag);
  const price = parseWholeNumber(form.basePrice);

  if (!name) errors.name = 'Indica o nome do produto.';
  else if (tooLong(name, LIMITS.name)) errors.name = tooLong(name, LIMITS.name);
  if (!slug) errors.slug = 'Indica o slug (parte final do endereço da página).';
  else if (!SLUG_PATTERN.test(slug)) errors.slug = 'Usa só letras minúsculas sem acentos, números e hífens (ex.: polo-seven).';
  else if (tooLong(slug, LIMITS.slug)) errors.slug = tooLong(slug, LIMITS.slug);
  if (!SITE_CONFIG.categories.some(category => category.id === form.category)) errors.category = 'Escolhe uma categoria.';
  if (tooLong(productType, LIMITS.productType)) errors.productType = tooLong(productType, LIMITS.productType);
  if (tooLong(description, LIMITS.description)) errors.description = tooLong(description, LIMITS.description);
  if (!price.ok) errors.basePrice = price.error;
  if (!STATUS_IDS.has(form.status)) errors.status = 'Escolhe um estado.';
  if (!ORDER_MODE_IDS.has(form.orderMode)) errors.orderMode = 'Escolhe o modo de pedido.';
  if (tooLong(tag, LIMITS.tag)) errors.tag = tooLong(tag, LIMITS.tag);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      name, slug, category: form.category, product_type: productType, description,
      base_price: price.ok ? price.value : null, status: form.status, featured: Boolean(form.featured),
      order_mode: form.orderMode, tag: tag || null
    }
  };
}

// Origem de imagem: URL https completo, caminho do site (/…) ou chave de assets/images.
export function validateImageSource(input) {
  const src = String(input ?? '').trim();
  if (!src) return { ok: false, error: 'Indica o URL ou a chave da imagem.' };
  if (src.length > LIMITS.url) return { ok: false, error: 'URL demasiado longo.' };
  if (/^https:\/\//i.test(src)) {
    try {
      new URL(src);
      return /\s/.test(src) ? { ok: false, error: 'O URL não pode ter espaços.' } : { ok: true, value: src, kind: 'url' };
    } catch {
      return { ok: false, error: 'URL inválido.' };
    }
  }
  if (/^http:\/\//i.test(src)) return { ok: false, error: 'Usa um endereço seguro (https://).' };
  if (/^\/[^\s/][^\s]*$/.test(src)) return { ok: true, value: src, kind: 'path' };
  if (SLUG_PATTERN.test(src)) {
    return Object.hasOwn(IMAGE_MANIFEST, src)
      ? { ok: true, value: src, kind: 'key' }
      : { ok: false, error: `Não existe nenhuma imagem do site com a chave "${src}".` };
  }
  return { ok: false, error: 'Usa um URL completo (https://…) ou a chave de uma imagem do site.' };
}

// Imagens do formulário → { valid, errors: [{ index, field, message }], rows } (alt vazio → nome do produto).
export function validateImages(images, productName = '') {
  const errors = [];
  const rows = images.map((image, index) => {
    const source = validateImageSource(image.src);
    if (!source.ok) errors.push({ index, field: 'src', message: source.error });
    const alt = clean(image.alt);
    const color = clean(image.color);
    if (tooLong(alt, LIMITS.alt)) errors.push({ index, field: 'alt', message: tooLong(alt, LIMITS.alt) });
    if (tooLong(color, LIMITS.color)) errors.push({ index, field: 'color', message: tooLong(color, LIMITS.color) });
    return {
      key: image.key,
      id: image.id ?? null,
      image_url: source.ok ? source.value : String(image.src ?? '').trim(),
      alt_text: alt || clean(productName),
      color: color || null,
      position: index
    };
  });
  return { valid: errors.length === 0, errors, rows };
}

// Variantes do formulário → { valid, errors: [{ index, field, message }], rows }.
export function validateVariants(variants) {
  const errors = [];
  const combos = new Map();
  const skus = new Map();
  const rows = variants.map((variant, index) => {
    const color = clean(variant.color);
    const size = clean(variant.size) || null;
    const sku = clean(variant.sku) || null;
    const stock = parseWholeNumber(variant.stock);
    const price = parseWholeNumber(variant.priceOverride);
    const push = (field, message) => errors.push({ index, field, message });

    if (!color) push('color', 'Indica a cor.');
    else if (tooLong(color, LIMITS.color)) push('color', tooLong(color, LIMITS.color));
    if (size && tooLong(size, LIMITS.size)) push('size', tooLong(size, LIMITS.size));
    if (!stock.ok) push('stock', `Stock: ${stock.error}`);
    if (!price.ok) push('priceOverride', `Preço: ${price.error}`);
    if (sku && tooLong(sku, LIMITS.sku)) push('sku', tooLong(sku, LIMITS.sku));

    if (color) {
      const combo = `${normalizeSearch(color)}|${(size ?? '').toUpperCase()}`;
      if (combos.has(combo)) push('size', `Combinação repetida: ${color} / ${sizeLabel(size)} (igual à linha ${combos.get(combo) + 1}).`);
      else combos.set(combo, index);
    }
    if (sku) {
      const skuKey = sku.toUpperCase();
      if (skus.has(skuKey)) push('sku', `SKU repetido (igual à linha ${skus.get(skuKey) + 1}).`);
      else skus.set(skuKey, index);
    }
    return {
      key: variant.key,
      id: variant.id ?? null,
      color,
      size,
      stock: stock.ok ? stock.value : null,
      price_override: price.ok ? price.value : null,
      sku,
      position: index
    };
  });
  return { valid: errors.length === 0, errors, rows };
}

// Opções do seletor de tamanho: Único (vazio) + tamanhos da configuração + valor atual, se for extra.
export function sizeOptions(current = '') {
  const options = [{ value: '', label: NO_SIZE_LABEL }, ...SITE_CONFIG.sizes.map(size => ({ value: size, label: size }))];
  if (current && !SITE_CONFIG.sizes.includes(current)) options.push({ value: current, label: current });
  return options;
}

// "Gerar tamanhos": novas linhas S…XXL para uma cor, sem repetir tamanhos que já existam para essa cor.
export function generateSizeRows(variants, color, makeKey, sizes = QUICK_SIZES) {
  const name = clean(color);
  if (!name) return [];
  const wanted = normalizeSearch(name);
  const existing = new Set(variants.filter(variant => normalizeSearch(variant.color) === wanted).map(variant => clean(variant.size).toUpperCase()));
  return sizes.filter(size => !existing.has(size.toUpperCase())).map(size => newVariantEntry(makeKey(), { color: name, size }));
}

export function moveItem(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

// Sincronização de linhas filhas (imagens/variantes): o que apagar, atualizar (só campos alterados) e inserir.
// original: linhas da base de dados com id. current: linhas validadas (id null = nova; key identifica a linha).
export function planSync(original, current, fields) {
  const originalById = new Map(original.map(row => [row.id, row]));
  const kept = new Set(current.map(row => row.id).filter(Boolean));
  const toDelete = original.filter(row => !kept.has(row.id)).map(row => row.id);
  const toUpdate = [];
  const toInsert = [];
  for (const row of current) {
    const payload = Object.fromEntries(fields.map(field => [field, row[field] ?? null]));
    const before = row.id ? originalById.get(row.id) : null;
    if (before) {
      const patch = Object.fromEntries(fields.filter(field => (before[field] ?? null) !== payload[field]).map(field => [field, payload[field]]));
      if (Object.keys(patch).length) toUpdate.push({ id: row.id, key: row.key, patch });
    } else {
      toInsert.push({ key: row.key, row: payload });
    }
  }
  return { toDelete, toUpdate, toInsert, empty: !toDelete.length && !toUpdate.length && !toInsert.length };
}

// Aplica o resultado de uma sincronização ao estado de referência e às linhas do formulário.
// result: { deleted: [id], updated: [{ id, patch }], inserted: [{ key, id, row }] }
export function applySyncResult(original, formRows, result) {
  const deleted = new Set(result.deleted);
  const patches = new Map(result.updated.map(item => [item.id, item.patch]));
  const next = original.filter(row => !deleted.has(row.id)).map(row => (patches.has(row.id) ? { ...row, ...patches.get(row.id) } : row));
  const insertedByKey = new Map(result.inserted.map(item => [item.key, item]));
  for (const item of result.inserted) next.push({ id: item.id, ...item.row });
  const rows = formRows.map(row => (insertedByKey.has(row.key) ? { ...row, id: insertedByKey.get(row.key).id } : row));
  return { original: next, rows };
}

// ─── Upload de imagens ───────────────────────────────────────────────────────

const formatMegabytes = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;

export function validateImageFile(file) {
  if (!file) return { ok: false, error: 'Escolhe um ficheiro.' };
  const ext = UPLOAD.types[file.type];
  if (!ext) return { ok: false, error: 'Formato não suportado. Usa JPG, PNG ou WebP.' };
  if (!(file.size > 0)) return { ok: false, error: 'O ficheiro está vazio.' };
  if (file.size > UPLOAD.maxBytes) return { ok: false, error: `O ficheiro tem ${formatMegabytes(file.size)}. O máximo é 5 MB.` };
  return { ok: true, ext };
}

// products/<product_id>/<timestamp>-<nome-em-slug>.<ext>
export function uploadPath(productId, fileName, mimeType, now = Date.now()) {
  const ext = UPLOAD.types[mimeType];
  if (!ext) throw new Error('Formato não suportado.');
  const base = slugify(String(fileName ?? '').replace(/\.[^.]*$/, '')).slice(0, 60).replace(/-+$/, '') || 'imagem';
  return `products/${productId}/${now}-${base}.${ext}`;
}

// URL público do Storage → caminho dentro do bucket (ou null se não pertencer ao bucket).
export function storagePathFromPublicUrl(url, supabaseUrl, bucket = UPLOAD.bucket) {
  const base = String(supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;
  const prefix = `${base}/storage/v1/object/public/${bucket}/`;
  const value = String(url ?? '');
  if (!value.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(value.slice(prefix.length).split(/[?#]/)[0]) || null;
  } catch {
    return null;
  }
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export function orderItemCount(order) {
  return (order?.order_items ?? []).reduce((sum, item) => (
    Number.isInteger(item?.quantity) && item.quantity > 0 ? sum + item.quantity : sum
  ), 0);
}

export function orderListRow(row) {
  return {
    id: String(row.id),
    number: String(row.order_number ?? ''),
    customerName: String(row.customer_name ?? ''),
    phoneLabel: formatPhone(row.phone),
    itemCount: orderItemCount(row),
    totalLabel: formatPrice(row.total, '—'),
    status: row.status,
    statusLabel: orderStatusLabel(row.status),
    createdAt: row.created_at ?? null
  };
}

// Filtro PostgREST "or" para pesquisa por número, nome ou telefone. Remove caracteres reservados da sintaxe.
// Com 6+ algarismos também procura o telefone ignorando espaços (ex.: "841234567" encontra "84 123 4567").
export function orderSearchFilter(q) {
  const term = String(q ?? '').replace(/[,()"'\\%*:.;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!term) return '';
  const parts = [`order_number.ilike.*${term}*`, `customer_name.ilike.*${term}*`, `phone.ilike.*${term}*`];
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 6) parts.push(`phone.ilike.*${digits.split('').join('*')}*`);
  return parts.join(',');
}

export function customerWhatsAppURL(order) {
  const digits = whatsappDigits(order?.phone);
  if (!digits) return null;
  const firstName = clean(order.customer_name).split(' ')[0];
  const greeting = firstName ? `Olá ${firstName}!` : 'Olá!';
  const reference = order.order_number ? ` sobre o teu pedido #${order.order_number}` : '';
  return buildWhatsAppURL(digits, `${greeting} Falamos da ${SITE_CONFIG.brandName}${reference}.`);
}

export function orderDetailFromDb(row) {
  const items = (row.order_items ?? []).map(item => {
    const quantity = Number.isInteger(item.quantity) ? item.quantity : 0;
    const unitPrice = Number.isInteger(item.unit_price) ? item.unit_price : null;
    return {
      name: String(item.product_name_snapshot ?? 'Produto'),
      color: item.color_snapshot || '—',
      size: sizeLabel(item.size_snapshot),
      quantity,
      unitPrice,
      subtotal: Number.isInteger(item.subtotal) ? item.subtotal : (unitPrice === null ? null : unitPrice * quantity)
    };
  });
  return {
    id: String(row.id),
    number: String(row.order_number ?? ''),
    customerName: String(row.customer_name ?? ''),
    phone: String(row.phone ?? ''),
    phoneLabel: formatPhone(row.phone),
    location: row.location ?? '',
    deliveryType: row.delivery_type ?? '',
    deliveryLabel: deliveryOption(row.delivery_type)?.label ?? String(row.delivery_type ?? '—'),
    notes: row.notes ?? '',
    subtotal: row.subtotal ?? null,
    deliveryFee: row.delivery_fee ?? null,
    total: row.total ?? null,
    status: row.status,
    statusLabel: orderStatusLabel(row.status),
    createdAt: row.created_at ?? null,
    items,
    itemCount: orderItemCount(row),
    whatsappURL: customerWhatsAppURL(row)
  };
}

// ─── Mensagens de erro ───────────────────────────────────────────────────────

export function authErrorMessage(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'Email ou palavra-passe incorretos.';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'Este email ainda não foi confirmado. Confirma a conta no Supabase (Authentication → Users).';
  if (code === 'user_banned') return 'Esta conta está bloqueada.';
  if (error?.status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return 'Demasiadas tentativas. Espera um pouco e tenta novamente.';
  if (error?.name === 'AuthRetryableFetchError' || message.includes('failed to fetch') || message.includes('network') || message.includes('abort')) {
    return 'Sem ligação ao servidor. Verifica a tua internet.';
  }
  return 'Não foi possível entrar. Tenta novamente.';
}

export function dbErrorMessage(error) {
  if (!error) return 'Ocorreu um erro inesperado.';
  const code = String(error.code ?? '');
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.error ?? ''}`.toLowerCase();
  if (code === '23505' || text.includes('duplicate key') || text.includes('already exists')) {
    if (text.includes('slug')) return 'Já existe um produto com este slug. Escolhe outro.';
    if (text.includes('sku')) return 'Este SKU já está a ser usado noutra variante.';
    if (text.includes('color') || text.includes('size') || text.includes('variant')) return 'Já existe uma variante com esta cor e tamanho.';
    if (text.includes('resource')) return 'Já existe um ficheiro com este nome. Tenta novamente.';
    return 'Já existe um registo com estes dados.';
  }
  if (code === '23514') return 'A base de dados recusou um valor (verifica preços, stock e estado).';
  if (code === '23502') return 'Falta preencher um campo obrigatório.';
  if (code === '23503') return 'O registo relacionado já não existe.';
  if (code === '22P02') return 'Identificador inválido.';
  if (code === 'NO_ROWS') return 'Nada foi alterado: o registo já não existe ou a tua conta não tem permissão.';
  if (code === '42501' || text.includes('row-level security') || text.includes('permission denied') || text.includes('unauthorized')) {
    return 'Sem permissão para esta operação. Confirma que a tua conta está na tabela admin_users.';
  }
  if (code === 'PGRST301' || code === 'PGRST303' || text.includes('jwt expired')) return 'A sessão expirou. Sai e entra novamente.';
  if (text.includes('bucket not found')) return `O bucket "${UPLOAD.bucket}" não existe no Supabase Storage (ver supabase/schema.sql).`;
  if (text.includes('payload too large') || text.includes('maximum allowed size')) return 'O ficheiro é demasiado grande.';
  if (text.includes('aborterror') || text.includes('timeout')) return 'O servidor demorou demasiado a responder. Tenta novamente.';
  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('network request failed') || text.includes('load failed')) {
    return 'Sem ligação ao servidor. Verifica a tua internet.';
  }
  return error.message ? `Erro do servidor: ${error.message}` : 'Ocorreu um erro inesperado.';
}
