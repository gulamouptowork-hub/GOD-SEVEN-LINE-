import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalOrderNumber, formatOrderNumber, isLocalOrderNumber } from '../js/lib/order-number.js';
import { formatPhone, isValidPhone, validateCustomer, whatsappDigits } from '../js/lib/validation.js';
import { buildInquiryMessage, buildOrderMessage, buildWhatsAppURL } from '../js/lib/whatsapp.js';
import { buildOrderDraft, confirmedOrder, createOrderArgs, deliveryFeeFor, orderTotals } from '../js/lib/order.js';
import { SITE_CONFIG } from '../config/site.js';

test('telefones de Moçambique e internacionais', () => {
  for (const phone of ['84 123 4567', '841234567', '+258 84 123 4567', '00258841234567', '258 87 020 4282', '21 123 456', '+27 82 123 4567', '+351 912 345 678']) {
    assert.equal(isValidPhone(phone), true, phone);
  }
  for (const phone of ['123', '81 123 4567', '912345678', '+258 91 234 5678', '8412345678', '', 'abc']) {
    assert.equal(isValidPhone(phone), false, phone);
  }
  assert.equal(formatPhone('841234567'), '84 123 4567');
  assert.equal(formatPhone('+258841234567'), '+258 84 123 4567');
  assert.equal(whatsappDigits('84 123 4567'), '258841234567');
});

test('validação do cliente', () => {
  const invalid = validateCustomer({ name: ' ', phone: '12', deliveryType: 'entrega', location: '' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.name && invalid.errors.phone && invalid.errors.location);
  const pickup = validateCustomer({ name: 'João Mussa', phone: '84 123 4567', deliveryType: 'levantamento' });
  assert.equal(pickup.valid, true);
  assert.equal(validateCustomer({ name: 'Ana', phone: '841234567', deliveryType: 'voo' }).errors.deliveryType, 'Escolhe a forma de entrega.');
  assert.ok(validateCustomer({ name: 'Ana', phone: '841234567', deliveryType: 'levantamento', notes: 'x'.repeat(501) }).errors.notes);
});

test('números de pedido', () => {
  assert.equal(formatOrderNumber(47), 'GSL-0047');
  assert.equal(formatOrderNumber(12345), 'GSL-12345');
  assert.throws(() => formatOrderNumber(0));
  const fixed = createLocalOrderNumber(new Date(2026, 8, 25), bytes => bytes.fill(0));
  assert.equal(fixed, 'GSL-260925-2222');
  const random = createLocalOrderNumber();
  assert.ok(isLocalOrderNumber(random), random);
  assert.notEqual(createLocalOrderNumber(), createLocalOrderNumber());
});

const order = {
  orderNumber: 'GSL-0047',
  customer: { name: 'João Mussa', phone: '841234567', location: 'Maputo', deliveryType: 'entrega', deliveryLabel: 'Entrega', notes: 'Entregar depois das 15h.\nPortão verde & número 7 — "casa" #2' },
  items: [
    { name: 'Seven Signature', color: 'Preto', size: 'M', quantity: 2, unitPrice: 1250, subtotal: 2500 },
    { name: 'Polo Seven', color: 'Rosa', size: 'L', quantity: 1, unitPrice: 1500, subtotal: 1500 }
  ],
  subtotal: 4000,
  deliveryFee: null,
  total: 4000
};

test('mensagem WhatsApp estruturada com total correto', () => {
  const message = buildOrderMessage(order);
  assert.ok(message.startsWith('Olá! 👋\nNovo pedido — GOD SEVEN LINE'));
  for (const line of ['Pedido: #GSL-0047', 'Cliente: João Mussa', 'Telefone: 84 123 4567', 'Localização: Maputo', 'Entrega: Entrega',
    '1. Seven Signature', 'Cor: Preto', 'Tamanho: M', 'Quantidade: 2', 'Preço unitário: 1.250 MT', 'Subtotal: 2.500 MT',
    '2. Polo Seven', 'Cor: Rosa', 'Tamanho: L', 'Subtotal: 1.500 MT', 'TOTAL: 4.000 MT', 'Observações:',
    'Gostaria de confirmar a disponibilidade deste pedido.']) {
    assert.ok(message.includes(line), line);
  }
  assert.ok(!buildOrderMessage({ ...order, customer: { ...order.customer, notes: '' } }).includes('Observações'));
  assert.ok(buildOrderMessage(order, { demo: true }).startsWith('⚠️ PEDIDO DE TESTE'));
});

test('URL WhatsApp codifica acentos, emoji, quebras de linha e símbolos', () => {
  const message = buildOrderMessage(order);
  const url = buildWhatsAppURL('258870204282', message);
  assert.ok(url.startsWith('https://wa.me/258870204282?text='));
  const encoded = url.split('?text=')[1];
  assert.ok(!/[\s#&"<>]/.test(encoded), 'sem caracteres inseguros na URL');
  assert.equal(decodeURIComponent(encoded), message);
  assert.equal(new URL(url).searchParams.get('text'), message);
  assert.ok(encoded.includes('%0A'), 'quebras de linha codificadas');
  assert.ok(encoded.includes(encodeURIComponent('👋')));
  assert.equal(buildWhatsAppURL('+258 87 020 4282'), 'https://wa.me/258870204282');
  assert.throws(() => buildWhatsAppURL('', 'x'));
});

test('mensagem de interesse para peças sem preço configurado', () => {
  const message = buildInquiryMessage({ productName: 'Polo Seven', color: 'Rosa', size: 'M' });
  assert.ok(message.includes('Polo Seven') && message.includes('Cor: Rosa · Tamanho: M'));
  assert.ok(message.endsWith('Podem confirmar o preço e a disponibilidade?'));
  // Com preço já publicado no site, só se pergunta a disponibilidade.
  const priced = buildInquiryMessage({ productName: 'Polo Seven', color: 'Rosa', priced: true });
  assert.ok(priced.endsWith('Podem confirmar a disponibilidade?'));
  assert.doesNotMatch(priced, /preço/);
});

const draftItems = [
  { productId: 'seven-signature', variantId: 'seven-signature-preto-m', name: 'Seven Signature', color: 'Preto', size: 'M', unitPrice: 1250, quantity: 2 },
  { productId: 'polo-seven', variantId: 'polo-seven-rosa-l', name: 'Polo Seven', color: 'Rosa', size: 'L', unitPrice: 1500, quantity: 1 }
];
const draftCustomer = { name: 'João Mussa', phone: '84 123 4567', location: '', deliveryType: 'entrega', notes: '' };

test('taxa de entrega: um só ponto de consulta, null sem taxa configurada', () => {
  assert.deepEqual(Object.keys(SITE_CONFIG.deliveryFees), [], 'nenhuma taxa inventada na configuração');
  for (const type of ['entrega', 'levantamento', 'constructor', '__proto__', undefined]) assert.equal(deliveryFeeFor(type), null, String(type));
  // Valor fictício, só para o teste.
  const fees = { entrega: 100, levantamento: 0, voo: -5, texto: '100' };
  assert.equal(deliveryFeeFor('entrega', fees), 100);
  assert.equal(deliveryFeeFor('levantamento', fees), 0);
  assert.equal(deliveryFeeFor('voo', fees), null);
  assert.equal(deliveryFeeFor('texto', fees), null);
  assert.equal(deliveryFeeFor('toString', fees), null);
  const draft = buildOrderDraft(draftItems, draftCustomer);
  assert.equal(draft.deliveryFee, null);
  assert.equal(draft.total, 4000);
  assert.equal(createOrderArgs(draft).p_expected_total, 4000);
});

test('com taxa configurada, resumo, mensagem e servidor dão o mesmo total', () => {
  const fees = { entrega: 100 }; // valor fictício
  const draft = buildOrderDraft(draftItems, draftCustomer, { fees });
  const review = orderTotals(draftItems, draftCustomer.deliveryType, { fees }); // o que o resumo mostra
  assert.deepEqual({ subtotal: draft.subtotal, deliveryFee: draft.deliveryFee, total: draft.total }, { subtotal: 4000, deliveryFee: 100, total: 4100 });
  assert.deepEqual({ subtotal: review.subtotal, deliveryFee: review.deliveryFee, total: review.total }, { subtotal: 4000, deliveryFee: 100, total: 4100 });
  // Levantamento sem taxa configurada: sem linha de entrega.
  assert.equal(orderTotals(draftItems, 'levantamento', { fees }).total, 4000);
  // A create_order ainda calcula total = subtotal das peças: é isso que tem de ir em p_expected_total.
  const args = createOrderArgs(draft);
  assert.equal(args.p_expected_total, 4000);
  assert.deepEqual(args.p_customer, { name: 'João Mussa', phone: '84 123 4567', location: null, delivery_type: 'entrega', notes: null });
  assert.deepEqual(args.p_items, [{ variant_id: 'seven-signature-preto-m', quantity: 2 }, { variant_id: 'polo-seven-rosa-l', quantity: 1 }]);
  // Resposta do servidor (total sem taxa): o pedido confirmado mantém a taxa e o total do resumo.
  const order = confirmedOrder(draft, { order_id: 'id-1', order_number: 'GSL-0047', subtotal: 4000, total: 4000, created_at: '2026-09-26T10:00:00Z' });
  assert.deepEqual({ orderNumber: order.orderNumber, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, persistence: order.persistence },
    { orderNumber: 'GSL-0047', subtotal: 4000, deliveryFee: 100, total: 4100, persistence: 'supabase' });
  const message = buildOrderMessage(order);
  for (const line of ['Subtotal: 4.000 MT', 'Entrega: 100 MT', 'TOTAL: 4.100 MT']) assert.ok(message.includes(line), line);
});

test('último pedido fica só no separador (sessionStorage) e o registo antigo em localStorage é apagado', async t => {
  const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map }; };
  const previous = { local: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), session: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage') };
  const local = memory();
  const session = memory();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true, writable: true });
  t.after(() => {
    for (const [name, descriptor] of [['localStorage', previous.local], ['sessionStorage', previous.session]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const { friendlyOrderError, loadLastOrder, submitOrder } = await import('../js/services/orders.js');
  const key = SITE_CONFIG.storageKeys.lastOrder;
  local.setItem(key, JSON.stringify({ orderNumber: 'GSL-ANTIGO', customer: { name: 'Cliente Anterior' } }));
  assert.equal(loadLastOrder(), null);
  assert.equal(local.getItem(key), null, 'registo antigo com dados do cliente apagado do dispositivo');
  // Sem backend (testes): pedido local, guardado apenas no separador.
  const order = await submitOrder(buildOrderDraft(draftItems, draftCustomer));
  assert.equal(order.persistence, 'local');
  assert.ok(isLocalOrderNumber(order.orderNumber));
  assert.equal(local.map.size, 0);
  assert.equal(loadLastOrder().orderNumber, order.orderNumber);
  // Sem resposta do servidor não se convida a repetir às cegas (o pedido pode já estar gravado).
  assert.match(friendlyOrderError({ code: 'ORDER_UNCONFIRMED' }), /pode já ter ficado registado/);
});
