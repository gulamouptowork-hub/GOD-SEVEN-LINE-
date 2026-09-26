// Rascunho do pedido: snapshot imutável dos itens, preços e dados do cliente.
import { SITE_CONFIG, deliveryOption } from '../../config/site.js';
import { cartTotals } from './cart.js';
import { isPrice } from './format.js';

// Taxa de entrega da forma escolhida, ou null quando não há taxa configurada (combinada pelo WhatsApp).
// Único ponto que lê SITE_CONFIG.deliveryFees: resumo, rascunho, mensagem e total usam sempre este valor.
export function deliveryFeeFor(deliveryType, fees = SITE_CONFIG.deliveryFees) {
  const fee = fees && Object.hasOwn(fees, deliveryType) ? fees[deliveryType] : null;
  return isPrice(fee) ? fee : null;
}

// Totais do pedido para uma forma de entrega (o que o cliente vê no resumo = o que vai na mensagem).
export function orderTotals(items, deliveryType, { fees } = {}) {
  return cartTotals(items, { deliveryFee: deliveryFeeFor(deliveryType, fees) });
}

export function buildOrderDraft(items, customer, { now = new Date(), fees } = {}) {
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
  const totals = orderTotals(items, customer.deliveryType, { fees });
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

// Argumentos da RPC create_order (supabase/schema.sql). O servidor recalcula o total e compara-o com
// p_expected_total; como a create_order ainda não conhece taxas de entrega (total = soma das peças),
// vai o subtotal — uma taxa configurada em deliveryFees nunca dá PRICE_CHANGED. Se a create_order passar
// a somar a taxa ao total, enviar aqui draft.total (e guardar a taxa em delivery_fee).
export function createOrderArgs(draft) {
  return {
    p_customer: {
      name: draft.customer.name,
      phone: draft.customer.phone,
      location: draft.customer.location || null,
      delivery_type: draft.customer.deliveryType,
      notes: draft.customer.notes || null
    },
    p_items: draft.items.map(item => ({ variant_id: item.variantId, quantity: item.quantity })),
    p_expected_total: draft.subtotal
  };
}

// Pedido confirmado pelo servidor: número, id e subtotal vêm da create_order; a taxa de entrega
// (que o servidor ainda não guarda) mantém-se a do rascunho, para o total bater certo com o resumo.
export function confirmedOrder(draft, row) {
  const subtotal = row.subtotal ?? draft.subtotal;
  return {
    ...draft,
    id: row.order_id,
    orderNumber: row.order_number,
    subtotal,
    total: subtotal + (draft.deliveryFee ?? 0),
    createdAt: row.created_at ?? draft.createdAt,
    persistence: 'supabase'
  };
}
