// Regras do pedido (puro — sem DOM nem storage).
// Uma linha guarda os ids + um snapshot para mostrar o pedido antes de os produtos carregarem.
// O snapshot NUNCA é a fonte de verdade: reconcileCart() revalida tudo contra o catálogo atual.
import {
  imagesForColor, isVariantPurchasable, productHasSizes, variantPrice, variantStatus
} from './catalog.js';
import { formatPrice, isPrice } from './format.js';

export class CartError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'CartError';
    this.code = code;
    this.meta = meta;
  }
}

export const unitsLabel = count => `${count} ${count === 1 ? 'unidade' : 'unidades'}`;

function snapshotLine(product, variant, quantity, addedAt) {
  return {
    productId: product.id,
    variantId: variant.id,
    slug: product.slug,
    name: product.name,
    color: variant.color,
    size: variant.size,
    image: imagesForColor(product, variant.color)[0]?.src ?? '',
    unitPrice: variantPrice(product, variant),
    quantity,
    addedAt
  };
}

function resolve(products, productId, variantId) {
  const product = products.find(item => item.id === productId) ?? null;
  const variant = product?.variants.find(item => item.id === variantId) ?? null;
  return { product, variant };
}

export function addToCart(items, products, { productId, variantId, quantity = 1 }, now = new Date()) {
  const { product, variant } = resolve(products, productId, variantId);
  if (!product || product.status !== 'active' || product.orderMode !== 'cart') {
    throw new CartError('PRODUCT_UNAVAILABLE', 'Esta peça não está disponível para pedido.');
  }
  if (!variant) {
    throw new CartError('VARIANT_REQUIRED', productHasSizes(product) ? 'Seleciona um tamanho.' : 'Seleciona uma opção.');
  }
  const status = variantStatus(product, variant);
  if (status === 'unconfigured') throw new CartError('NOT_CONFIGURED', 'Esta peça ainda não tem preço e stock configurados.');
  if (status === 'soldout') throw new CartError('SOLD_OUT', 'Este tamanho está esgotado.');
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) throw new CartError('INVALID_QUANTITY', 'Escolhe uma quantidade válida.');
  const existing = items.find(item => item.variantId === variantId);
  const next = (existing?.quantity ?? 0) + amount;
  if (next > variant.stock) {
    const message = existing
      ? `Só temos ${unitsLabel(variant.stock)} deste tamanho e já tens ${existing.quantity} no teu pedido.`
      : `Só temos ${unitsLabel(variant.stock)} disponíveis.`;
    throw new CartError('STOCK_LIMIT', message, { stock: variant.stock, inCart: existing?.quantity ?? 0 });
  }
  const line = snapshotLine(product, variant, next, existing?.addedAt ?? now.toISOString());
  return existing ? items.map(item => (item.variantId === variantId ? line : item)) : [...items, line];
}

export function setCartQuantity(items, products, variantId, quantity) {
  const line = items.find(item => item.variantId === variantId);
  if (!line) return items;
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) throw new CartError('INVALID_QUANTITY', 'A quantidade mínima é 1.');
  if (products?.length) {
    const { product, variant } = resolve(products, line.productId, variantId);
    if (!product || !variant || !isVariantPurchasable(product, variant)) {
      throw new CartError('PRODUCT_UNAVAILABLE', 'Esta peça já não está disponível.');
    }
    if (amount > variant.stock) {
      throw new CartError('STOCK_LIMIT', `Só temos ${unitsLabel(variant.stock)} disponíveis.`, { stock: variant.stock });
    }
  }
  return items.map(item => (item.variantId === variantId ? { ...item, quantity: amount } : item));
}

export function removeFromCart(items, variantId) {
  return items.filter(item => item.variantId !== variantId);
}

// Revalida o pedido contra o catálogo atual: remove o que deixou de existir ou esgotou,
// ajusta quantidades ao stock e atualiza preços. Devolve as alterações para informar o cliente.
export function reconcileCart(items, products) {
  const changes = [];
  const merged = new Map();
  for (const item of items) {
    const previous = merged.get(item.variantId);
    merged.set(item.variantId, previous ? { ...previous, quantity: previous.quantity + item.quantity } : item);
  }
  const next = [];
  for (const item of merged.values()) {
    const { product, variant } = resolve(products, item.productId, item.variantId);
    if (!product || !variant || !isVariantPurchasable(product, variant)) {
      changes.push({ type: 'removed', name: item.name, reason: variant && variantStatus(product, variant) === 'soldout' ? 'soldout' : 'unavailable' });
      continue;
    }
    const line = snapshotLine(product, variant, Math.min(item.quantity, variant.stock), item.addedAt);
    if (line.quantity !== item.quantity) changes.push({ type: 'quantity', name: line.name, from: item.quantity, to: line.quantity });
    if (isPrice(item.unitPrice) && line.unitPrice !== item.unitPrice) changes.push({ type: 'price', name: line.name, from: item.unitPrice, to: line.unitPrice });
    next.push(line);
  }
  return { items: next, changes };
}

export function describeCartChange(change) {
  if (change.type === 'removed') return change.reason === 'soldout'
    ? `${change.name} esgotou e foi removida do teu pedido.`
    : `${change.name} já não está disponível e foi removida do teu pedido.`;
  if (change.type === 'quantity') return `${change.name}: a quantidade foi ajustada para ${change.to} (stock disponível).`;
  if (change.type === 'price') return `${change.name}: o preço foi atualizado de ${formatPrice(change.from)} para ${formatPrice(change.to)}.`;
  return '';
}

export function cartLines(items, products = []) {
  return items.map(item => {
    const { product, variant } = resolve(products, item.productId, item.variantId);
    return {
      ...item,
      lineTotal: isPrice(item.unitPrice) ? item.unitPrice * item.quantity : 0,
      maxQuantity: variant && Number.isInteger(variant.stock) ? variant.stock : null,
      product,
      variant
    };
  });
}

export function cartTotals(items, { deliveryFee = null } = {}) {
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + (isPrice(item.unitPrice) ? item.unitPrice * item.quantity : 0), 0);
  const fee = isPrice(deliveryFee) ? deliveryFee : null;
  return { quantity, lines: items.length, subtotal, deliveryFee: fee, total: subtotal + (fee ?? 0) };
}

// Dados vindos do localStorage não são de confiança: manter só linhas com forma válida.
export function sanitizeStoredItems(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object'
    && typeof item.productId === 'string' && typeof item.variantId === 'string'
    && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 999)
    .map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      slug: typeof item.slug === 'string' ? item.slug : '',
      name: typeof item.name === 'string' ? item.name : '',
      color: typeof item.color === 'string' ? item.color : '',
      size: typeof item.size === 'string' ? item.size : null,
      image: typeof item.image === 'string' ? item.image : '',
      unitPrice: isPrice(item.unitPrice) ? item.unitPrice : null,
      quantity: item.quantity,
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : null
    }));
}
