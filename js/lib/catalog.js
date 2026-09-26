// Modelo de produto e regras de catálogo (puro — usado no browser, no build e nos testes).
//
// Produto normalizado:
// { id, slug, name, category, productType, description, basePrice, status, featured, orderMode,
//   tag, createdAt, updatedAt, images: [{ src, alt, color }],
//   variants: [{ id, color, size, stock, priceOverride, sku }] }
//
// Preço final de uma variante: priceOverride ?? basePrice.
// Uma variante só é vendável quando tem preço (>= 0) e stock inteiro conhecido.
import { SITE_CONFIG, categoryLabel } from '../../config/site.js';
import { formatPrice, isPrice } from './format.js';
import { normalizeSearch } from './html.js';

const STATUSES = new Set(['active', 'draft', 'archived']);
const ORDER_MODES = new Set(['cart', 'custom']);

const toNumberOrNull = value => (value === null || value === undefined || value === '' ? null : Number(value));
const toPriceOrNull = value => {
  const number = toNumberOrNull(value);
  return isPrice(number) ? number : null;
};
const toStockOrNull = value => {
  const number = toNumberOrNull(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Produto inválido.');
  const images = (raw.images ?? [])
    .map((image, index) => (typeof image === 'string' ? { src: image } : image))
    .filter(image => image && image.src)
    .map((image, index) => ({ src: String(image.src), alt: image.alt ?? '', color: image.color ?? null, position: image.position ?? index }))
    .sort((a, b) => a.position - b.position)
    .map(({ position, ...image }) => image);
  const variants = (raw.variants ?? []).map((variant, index) => ({
    id: String(variant.id ?? `${raw.id}-${index}`),
    color: variant.color ? String(variant.color) : 'Único',
    size: variant.size ? String(variant.size) : null,
    stock: toStockOrNull(variant.stock),
    priceOverride: toPriceOrNull(variant.priceOverride),
    sku: variant.sku ?? null,
    position: variant.position ?? index
  })).sort((a, b) => a.position - b.position).map(({ position, ...variant }) => variant);
  return {
    id: String(raw.id),
    slug: String(raw.slug),
    name: String(raw.name ?? ''),
    category: String(raw.category ?? ''),
    productType: String(raw.productType ?? ''),
    description: String(raw.description ?? ''),
    basePrice: toPriceOrNull(raw.basePrice),
    status: STATUSES.has(raw.status) ? raw.status : 'draft',
    featured: Boolean(raw.featured),
    orderMode: ORDER_MODES.has(raw.orderMode) ? raw.orderMode : 'cart',
    tag: raw.tag ? String(raw.tag) : null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    images,
    variants
  };
}

// Validação estrita para dados de origem (build). Devolve lista de erros legíveis.
export function validateCatalog(rawProducts) {
  const errors = [];
  const slugs = new Set();
  const variantIds = new Set();
  if (!Array.isArray(rawProducts)) return ['O catálogo deve ser uma lista de produtos.'];
  rawProducts.forEach((product, index) => {
    const where = `produto #${index + 1} (${product?.slug ?? product?.name ?? '?'})`;
    if (!product?.id) errors.push(`${where}: falta id.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product?.slug ?? '')) errors.push(`${where}: slug inválido.`);
    if (slugs.has(product?.slug)) errors.push(`${where}: slug duplicado.`);
    slugs.add(product?.slug);
    if (!product?.name) errors.push(`${where}: falta nome.`);
    if (!SITE_CONFIG.categories.some(category => category.id === product?.category)) errors.push(`${where}: categoria desconhecida "${product?.category}".`);
    if (product?.basePrice !== null && product?.basePrice !== undefined && !isPrice(product.basePrice)) errors.push(`${where}: preço base inválido.`);
    if (!Array.isArray(product?.images) || !product.images.length) errors.push(`${where}: precisa de pelo menos uma imagem.`);
    (product?.variants ?? []).forEach(variant => {
      if (!variant.id) errors.push(`${where}: variante sem id.`);
      if (variantIds.has(variant.id)) errors.push(`${where}: id de variante duplicado "${variant.id}".`);
      variantIds.add(variant.id);
      if (variant.stock !== null && variant.stock !== undefined && !(Number.isInteger(variant.stock) && variant.stock >= 0)) errors.push(`${where}: stock inválido em ${variant.id}.`);
      if (variant.priceOverride !== null && variant.priceOverride !== undefined && !isPrice(variant.priceOverride)) errors.push(`${where}: preço inválido em ${variant.id}.`);
    });
  });
  return errors;
}

export function variantPrice(product, variant) {
  if (variant && isPrice(variant.priceOverride)) return variant.priceOverride;
  return isPrice(product?.basePrice) ? product.basePrice : null;
}

export function isVariantConfigured(product, variant) {
  return Boolean(variant) && isPrice(variantPrice(product, variant)) && Number.isInteger(variant.stock) && variant.stock >= 0;
}

// 'unconfigured' | 'soldout' | 'low' | 'available'
export function variantStatus(product, variant) {
  if (!isVariantConfigured(product, variant)) return 'unconfigured';
  if (variant.stock === 0) return 'soldout';
  if (variant.stock <= SITE_CONFIG.lowStockThreshold) return 'low';
  return 'available';
}

export function isVariantPurchasable(product, variant) {
  return product?.status === 'active' && product.orderMode === 'cart' && ['available', 'low'].includes(variantStatus(product, variant));
}

// state: 'unavailable' | 'custom' | 'unconfigured' | 'soldout' | 'low' | 'available'
export function productAvailability(product) {
  if (!product || product.status !== 'active') return { state: 'unavailable', totalStock: 0, purchasable: false };
  if (product.orderMode === 'custom') return { state: 'custom', totalStock: 0, purchasable: false };
  const configured = product.variants.filter(variant => isVariantConfigured(product, variant));
  if (!configured.length) return { state: 'unconfigured', totalStock: 0, purchasable: false };
  const totalStock = configured.reduce((sum, variant) => sum + variant.stock, 0);
  if (totalStock === 0) return { state: 'soldout', totalStock, purchasable: false };
  return { state: totalStock <= SITE_CONFIG.productLowStockThreshold ? 'low' : 'available', totalStock, purchasable: true };
}

export function productPriceRange(product) {
  const prices = product.variants.map(variant => variantPrice(product, variant)).filter(isPrice);
  if (!prices.length && isPrice(product.basePrice)) prices.push(product.basePrice);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export const PRICE_ON_REQUEST = 'Preço sob consulta';

export function productPriceLabel(product) {
  const range = productPriceRange(product);
  if (!range) return PRICE_ON_REQUEST;
  return range.min === range.max ? formatPrice(range.min) : `Desde ${formatPrice(range.min)}`;
}

export function isNewProduct(product, now = new Date()) {
  if (!product?.createdAt) return false;
  const created = new Date(product.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const age = now.getTime() - created;
  return age >= 0 && age <= SITE_CONFIG.newProductDays * 86400000;
}

// Etiqueta do cartão. Prioridade: ESGOTADO > ÚLTIMAS UNIDADES > NOVO > etiqueta editorial.
export function productBadge(product, now = new Date()) {
  const { state } = productAvailability(product);
  if (state === 'soldout') return { id: 'soldout', label: 'ESGOTADO' };
  if (state === 'low') return { id: 'low', label: 'ÚLTIMAS UNIDADES' };
  if (isNewProduct(product, now)) return { id: 'new', label: 'NOVO' };
  if (product.tag) return { id: 'tag', label: product.tag };
  return null;
}

export function swatchColor(name) {
  return SITE_CONFIG.colorSwatches[name] ?? '#b9bab2';
}

export function productColors(product) {
  const colors = [];
  for (const variant of product.variants) {
    let entry = colors.find(color => color.name === variant.color);
    if (!entry) colors.push(entry = { name: variant.color, hex: swatchColor(variant.color), available: false });
    if (isVariantPurchasable(product, variant)) entry.available = true;
  }
  return colors;
}

const sizeRank = size => {
  if (!size) return -1;
  const index = SITE_CONFIG.sizes.indexOf(size);
  return index === -1 ? SITE_CONFIG.sizes.length : index;
};

export function variantsForColor(product, color) {
  return product.variants.filter(variant => variant.color === color).sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
}

export function productHasSizes(product) {
  return product.variants.some(variant => variant.size);
}

export function findVariant(product, color, size) {
  return product.variants.find(variant => variant.color === color && (variant.size ?? null) === (size ?? null)) ?? null;
}

export function imagesForColor(product, color) {
  const matching = product.images.filter(image => !image.color || image.color === color);
  return matching.length ? matching : product.images;
}

export function productSearchText(product) {
  return normalizeSearch([
    product.name, product.productType, categoryLabel(product.category), product.tag,
    ...new Set(product.variants.map(variant => variant.color))
  ].filter(Boolean).join(' '));
}

export function categoryFromParam(value) {
  const wanted = normalizeSearch(value);
  if (!wanted || wanted === 'todos') return '';
  return SITE_CONFIG.categories.find(category => category.id === wanted || normalizeSearch(category.label) === wanted)?.id ?? '';
}

export const EMPTY_FILTERS = Object.freeze({ category: '', size: '', availability: '', price: '', q: '' });

export function filterProducts(products, filters = EMPTY_FILTERS) {
  const tokens = normalizeSearch(filters.q).split(/\s+/).filter(Boolean);
  const range = SITE_CONFIG.priceRanges.find(item => item.id === filters.price);
  return products.filter(product => {
    if (filters.category && product.category !== filters.category) return false;
    if (filters.size && !product.variants.some(variant => variant.size === filters.size && variantStatus(product, variant) !== 'soldout')) return false;
    if (filters.availability) {
      const { state } = productAvailability(product);
      if (filters.availability === 'available' && !['available', 'low'].includes(state)) return false;
      if (filters.availability === 'soldout' && state !== 'soldout') return false;
    }
    if (range) {
      const prices = productPriceRange(product);
      if (!prices) return false;
      // Faixas (min, max]: "Até 1.000" inclui 1.000 (e o 0), "1.000 — 2.000" vai de acima de 1.000 até 2.000,
      // "Mais de 2.000" é acima de 2.000.
      const aboveMin = range.min > 0 ? prices.min > range.min : prices.min >= range.min;
      if (!aboveMin || (range.max !== null && prices.min > range.max)) return false;
    }
    if (tokens.length) {
      const text = productSearchText(product);
      if (!tokens.every(token => text.includes(token))) return false;
    }
    return true;
  });
}

export const SORT_OPTIONS = Object.freeze([
  Object.freeze({ id: 'recent', label: 'Mais recentes' }),
  Object.freeze({ id: 'price-asc', label: 'Preço: menor para maior' }),
  Object.freeze({ id: 'price-desc', label: 'Preço: maior para menor' }),
  Object.freeze({ id: 'name', label: 'Nome' })
]);

export function sortProducts(products, sort = 'recent') {
  const indexed = products.map((product, index) => ({ product, index, range: productPriceRange(product) }));
  const byIndex = (a, b) => a.index - b.index;
  const compare = {
    'price-asc': (a, b) => (a.range ? a.range.min : Infinity) - (b.range ? b.range.min : Infinity) || byIndex(a, b),
    'price-desc': (a, b) => (b.range ? b.range.max : -Infinity) - (a.range ? a.range.max : -Infinity) || byIndex(a, b),
    name: (a, b) => a.product.name.localeCompare(b.product.name, 'pt') || byIndex(a, b),
    recent: (a, b) => {
      const time = item => (item.product.createdAt ? new Date(item.product.createdAt).getTime() : -Infinity);
      return (time(b) - time(a)) || (Number(b.product.featured) - Number(a.product.featured)) || byIndex(a, b);
    }
  }[sort] ?? byIndex;
  return indexed.sort(compare).map(item => item.product);
}

export function productURL(product) {
  return `/produtos/${encodeURIComponent(product.slug)}`;
}
