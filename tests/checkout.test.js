import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalOrderNumber, formatOrderNumber, isLocalOrderNumber } from '../js/lib/order-number.js';
import { formatPhone, isValidPhone, validateCustomer, whatsappDigits } from '../js/lib/validation.js';
import { buildInquiryMessage, buildOrderMessage, buildWhatsAppURL } from '../js/lib/whatsapp.js';

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
});
