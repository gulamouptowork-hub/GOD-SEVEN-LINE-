// Criação do pedido antes de abrir o WhatsApp.
//  • Com Supabase: RPC create_order — o servidor revalida stock/preços, guarda snapshots e devolve GSL-0047.
//  • Sem backend: o pedido fica guardado apenas neste separador (sessionStorage) com um ID temporário.
import { SITE_CONFIG } from '../../config/site.js';
import { confirmedOrder, createOrderArgs } from '../lib/order.js';
import { createLocalOrderNumber } from '../lib/order-number.js';
import { hasBackend } from './runtime.js';
import { ServiceError, supabaseRpc } from './supabase-rest.js';

// A create_order pode demorar em redes móveis lentas: cortar cedo não anula um pedido já gravado.
const ORDER_TIMEOUT = 30000;

const FRIENDLY = {
  EMPTY_ORDER: 'O teu pedido está vazio.',
  INVALID_CUSTOMER: 'Revê os teus dados: nome, telefone e forma de entrega são obrigatórios.',
  INVALID_ITEM: 'O pedido tem uma peça inválida. Atualiza a página e tenta novamente.',
  PRODUCT_UNAVAILABLE: 'Uma das peças já não está disponível.',
  STOCK_INSUFFICIENT: 'Uma das peças já não tem stock suficiente.',
  PRICE_CHANGED: 'Os preços foram atualizados. Revê o teu pedido antes de enviar.',
  TOO_MANY_ITEMS: 'O pedido tem demasiadas linhas.',
  ORDER_UNCONFIRMED: 'Não recebemos a confirmação do servidor e o pedido pode já ter ficado registado. Antes de o enviares de novo, fala connosco pelo WhatsApp para confirmarmos.'
};

export function friendlyOrderError(error) {
  return FRIENDLY[error?.code] ?? error?.message ?? 'Não foi possível preparar o pedido.';
}

// O último pedido (com os dados do cliente) só serve para reabrir o ecrã final neste separador,
// incluindo ao voltar do WhatsApp no telemóvel — por isso sessionStorage e não localStorage.
function storage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

export function saveLastOrder(order) {
  try { storage()?.setItem(SITE_CONFIG.storageKeys.lastOrder, JSON.stringify(order)); } catch { /* sem storage */ }
}

export function loadLastOrder() {
  // Versões anteriores guardavam-no em localStorage, sem prazo: apagar o que tenha ficado no dispositivo.
  try { globalThis.localStorage?.removeItem(SITE_CONFIG.storageKeys.lastOrder); } catch { /* sem storage */ }
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
    result = await supabaseRpc('create_order', createOrderArgs(draft), { timeout: ORDER_TIMEOUT });
  } catch (error) {
    // Sem resposta (tempo esgotado ou ligação perdida) o pedido pode ter sido gravado na mesma:
    // avisar em vez de convidar a repetir, que criaria um pedido duplicado.
    if (['TIMEOUT', 'NETWORK'].includes(error?.code)) throw new ServiceError('ORDER_UNCONFIRMED', FRIENDLY.ORDER_UNCONFIRMED, { cause: error.code });
    if (error instanceof ServiceError) throw new ServiceError(error.code, friendlyOrderError(error), error.details);
    throw error;
  }
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.order_number) throw new ServiceError('INVALID_RESPONSE', 'O servidor não confirmou o pedido.');
  const order = confirmedOrder(draft, row);
  saveLastOrder(order);
  return order;
}
