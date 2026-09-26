import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct } from '../js/lib/catalog.js';
import { buildInquiryMessage } from '../js/lib/whatsapp.js';
import {
  colorBlock, howtoStepsHTML, initialSelection, inquiryDetails, purchaseHTML, restoreSelection
} from '../js/ui/product-templates.js';
import { byslug, demoProducts, realProducts } from './helpers.js';

const withStock = (product, change) => ({ ...product, variants: product.variants.map(variant => ({ ...variant, ...change(variant) })) });
const rosaSoldout = () => withStock(byslug(demoProducts(), 'polo-seven'), variant => (variant.color === 'Rosa' ? { stock: 0 } : {}));
const cap = normalizeProduct({
  id: 'bone', slug: 'bone', name: 'Boné', category: 'acessorios', basePrice: 500, status: 'active', orderMode: 'cart', images: ['x'],
  variants: [{ id: 'bone-preto', color: 'Preto', size: null, stock: 3 }, { id: 'bone-branco', color: 'Branco', size: null, stock: 0 }]
});
const count = (html, pattern) => (html.match(pattern) ?? []).length;

test('uma cor esgotada desativa o botão e diz porquê', () => {
  const polo = rosaSoldout();
  assert.equal(colorBlock(polo, 'Vermelho'), null);
  assert.deepEqual(colorBlock(polo, 'Rosa'), { label: 'ESGOTADO', message: 'Esta cor está esgotada.' });
  assert.deepEqual(colorBlock(byslug(demoProducts(), 'seven-street-tee'), 'Preto'), { label: 'ESGOTADO', message: 'Esta peça está esgotada.' });
  const unpublished = withStock(polo, variant => (variant.color === 'Rosa' ? { stock: null } : {}));
  assert.equal(colorBlock(unpublished, 'Rosa').label, 'INDISPONÍVEL');

  const html = purchaseHTML(polo, { color: 'Rosa', variantId: null, quantity: 1 });
  assert.match(html, /data-add-button disabled>\s*<span data-add-label>ESGOTADO</);
  assert.match(html, /data-qty-input[^>]*disabled/);
  assert.match(purchaseHTML(polo, { color: 'Vermelho', variantId: null, quantity: 1 }), /data-add-button>\s*<span data-add-label>ADICIONAR AO PEDIDO</);
});

test('peças sem tamanhos também têm a mensagem de stock (uma só)', () => {
  const sized = purchaseHTML(byslug(demoProducts(), 'polo-seven'), initialSelection(byslug(demoProducts(), 'polo-seven')));
  assert.equal(count(sized, /data-stock-message/g), 1);
  const sizeless = purchaseHTML(cap, initialSelection(cap));
  assert.equal(count(sizeless, /data-stock-message/g), 1);
  assert.match(purchaseHTML(cap, { color: 'Branco', variantId: null, quantity: 1 }), /data-add-label>ESGOTADO</);
});

test('o formulário de compra não faz envio nativo antes de o JS carregar', () => {
  const polo = byslug(demoProducts(), 'polo-seven');
  assert.match(purchaseHTML(polo, initialSelection(polo)), /<form class="purchase-form" data-purchase-form method="dialog"/);
});

test('ao hidratar, uma cor estática que esgotou dá lugar à primeira cor com stock', () => {
  const polo = rosaSoldout();
  assert.deepEqual(restoreSelection(polo, { color: 'Rosa', variantId: 'polo-seven-rosa-m' }), { color: 'Vermelho', variantId: null, quantity: 1 });
  assert.deepEqual(restoreSelection(polo, { color: 'Vermelho', variantId: 'polo-seven-vermelho-m' }), { color: 'Vermelho', variantId: 'polo-seven-vermelho-m', quantity: 1 });
  assert.equal(restoreSelection(polo, { color: 'Vermelho', variantId: 'polo-seven-rosa-m' }).variantId, null, 'tamanho de outra cor');
  assert.equal(restoreSelection(polo, { color: 'Azul' }).color, 'Vermelho', 'cor que já não existe');
  // Sem nenhuma cor com stock (pergunta no WhatsApp ou tudo esgotado) mantém-se a escolha do cliente.
  const real = byslug(realProducts(), 'polo-seven');
  assert.equal(restoreSelection(real, { color: 'Vermelho' }).color, 'Vermelho');
});

test('peça com preço mas sem stock publicado não diz que falta o preço', () => {
  const priced = withStock({ ...byslug(realProducts(), 't-shirt-seven'), basePrice: 1250 }, () => ({}));
  const unpriced = byslug(realProducts(), 't-shirt-seven');
  const selection = initialSelection(priced);

  const pricedHTML = purchaseHTML(priced, selection);
  assert.match(pricedHTML, /Disponibilidade por confirmar\./);
  assert.doesNotMatch(pricedHTML, /ainda não tem preço/);
  assert.match(purchaseHTML(unpriced, selection), /Preço e disponibilidade por confirmar\.[\s\S]*ainda não tem preço e stock publicados/);

  assert.equal(inquiryDetails(priced, selection).priced, true);
  assert.equal(inquiryDetails(unpriced, selection).priced, false);
  assert.ok(buildInquiryMessage(inquiryDetails(priced, selection)).endsWith('Podem confirmar a disponibilidade?'));
  assert.ok(buildInquiryMessage(inquiryDetails(unpriced, selection)).endsWith('Podem confirmar o preço e a disponibilidade?'));
});

test('"Como funciona o pedido" só fala do pedido quando a peça se pode adicionar', () => {
  const demo = demoProducts();
  assert.match(howtoStepsHTML(byslug(demo, 'polo-seven')), /teu pedido/);
  assert.match(howtoStepsHTML(byslug(demo, 'seven-street-tee')), /teu pedido/, 'esgotada continua a ser uma peça do pedido');
  for (const product of realProducts()) {
    const steps = howtoStepsHTML(product);
    assert.doesNotMatch(steps, /teu pedido|quantidade/, product.slug);
    assert.match(steps, /WhatsApp/, product.slug);
  }
  assert.match(howtoStepsHTML(byslug(realProducts(), 'polo-seven')), /o preço, a disponibilidade/);
  assert.match(howtoStepsHTML({ ...byslug(realProducts(), 'polo-seven'), basePrice: 1500 }), /Confirmamos contigo a disponibilidade e a entrega/);
  assert.match(howtoStepsHTML(byslug(realProducts(), 'a-tua-estampa')), /Partilha a tua ideia/);
});
