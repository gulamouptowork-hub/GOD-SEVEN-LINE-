// Criação do pedido antes de abrir o WhatsApp.
//  • Com Supabase: RPC create_order — o servidor revalida stock/preços, guarda snapshots e devolve GSL-0047.
//  • Sem backend: o pedido fica guardado apenas neste dispositivo com um ID temporário.
import { SITE_CONFIG } from '../../config/site.js';
import { createLocalOrderNumber } from '../lib/order-number.js';
import { hasBackend } from './runtime.js';
import { ServiceError, supabaseRpc } from './supabase-rest.js';

const FRIENDLY = {
  EMPTY_ORDER: 'O teu pedido está vazio.',
  INVALID_CUSTOMER: 'Revê os teus dados: nome, telefone e forma de entrega são obrigatórios.',
  INVALID_ITEM: 'O pedido tem uma peça inválida. Atualiza a página e tenta novamente.',
  PRODUCT_UNAVAILABLE: 'Uma das peças já não está disponível.',
  STOCK_INSUFFICIENT: 'Uma das peças já não tem stock suficiente.',
  PRICE_CHANGED: 'Os preços foram atualizados. Revê o teu pedido antes de enviar.',
  TOO_MANY_ITEMS: 'O pedido tem demasiadas linhas.'
};

export function friendlyOrderError(error) {
  return FRIENDLY[error?.code] ?? error?.message ?? 'Não foi possível preparar o pedido.';
}

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function saveLastOrder(order) {
  try { storage()?.setItem(SITE_CONFIG.storageKeys.lastOrder, JSON.stringify(order)); } catch { /* sem storage */ }
}

export function loadLastOrder() {
  try { return JSON.parse(storage()?.getItem(SITE_CONFIG.storageKeys.lastOrder) ?? 'null'); } catch { return null; }
}

export async function submitOrder(draft) {
  if (!hasBackend) {
    const order = { ...draft, orderNumber: createLocalOrderNumber(), persistence: 'local' };
    saveLastOrder(order);
    return order;
  }
  let result;
  try {
    result = await supabaseRpc('create_order', {
      p_customer: {
        name: draft.customer.name,
        phone: draft.customer.phone,
        location: draft.customer.location || null,
        delivery_type: draft.customer.deliveryType,
        notes: draft.customer.notes || null
      },
      p_items: draft.items.map(item => ({ variant_id: item.variantId, quantity: item.quantity })),
      p_expected_total: draft.total
    });
  } catch (error) {
    if (error instanceof ServiceError) throw new ServiceError(error.code, friendlyOrderError(error), error.details);
    throw error;
  }
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.order_number) throw new ServiceError('INVALID_RESPONSE', 'O servidor não confirmou o pedido.');
  const order = {
    ...draft,
    id: row.order_id,
    orderNumber: row.order_number,
    subtotal: row.subtotal ?? draft.subtotal,
    total: row.total ?? draft.total,
    createdAt: row.created_at ?? draft.createdAt,
    persistence: 'supabase'
  };
  saveLastOrder(order);
  return order;
}
