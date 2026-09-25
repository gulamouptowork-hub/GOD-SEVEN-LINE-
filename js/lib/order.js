// Rascunho do pedido: snapshot imutável dos itens, preços e dados do cliente.
import { SITE_CONFIG, deliveryOption } from '../../config/site.js';
import { cartTotals } from './cart.js';
import { isPrice } from './format.js';

export function buildOrderDraft(items, customer, { now = new Date() } = {}) {
  const lines = items.map(item => ({
    productId: item.productId,
    variantId: item.variantId,
    name: item.name,
    color: item.color,
    size: item.size ?? null,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    subtotal: item.unitPrice * item.quantity
  }));
  if (!lines.length) throw new Error('O teu pedido está vazio.');
  if (lines.some(line => !isPrice(line.unitPrice) || !Number.isInteger(line.quantity) || line.quantity < 1)) {
    throw new Error('O pedido tem itens inválidos.');
  }
  const deliveryFee = SITE_CONFIG.deliveryFees[customer.deliveryType] ?? null;
  const totals = cartTotals(items, { deliveryFee });
  return {
    orderNumber: null,
    createdAt: now.toISOString(),
    status: 'novo',
    customer: {
      name: customer.name,
      phone: customer.phone,
      location: customer.location || '',
      deliveryType: customer.deliveryType,
      deliveryLabel: deliveryOption(customer.deliveryType)?.label ?? customer.deliveryType,
      notes: customer.notes || ''
    },
    items: lines,
    quantity: totals.quantity,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total
  };
}
