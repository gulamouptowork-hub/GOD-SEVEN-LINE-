import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToCart, cartTotals, reconcileCart, removeFromCart, sanitizeStoredItems, setCartQuantity
} from '../js/lib/cart.js';
import { buildOrderDraft } from '../js/lib/order.js';
import { createCartStore } from '../js/store/cart-store.js';
import { cartLineLabel, emptyOrderHTML } from '../js/ui/templates.js';
import { byslug, demoProducts, memoryStorage, variantOf } from './helpers.js';

const products = demoProducts();
const signature = byslug(products, 'seven-signature');
const polo = byslug(products, 'polo-seven');
const tee = byslug(products, 't-shirt-seven');
const add = (items, product, color, size, quantity) =>
  addToCart(items, products, { productId: product.id, variantId: variantOf(product, color, size)?.id, quantity });

test('cálculo: 2 × 1.250 + 1 × 1.500 = 4.000', () => {
  let items = add([], signature, 'Preto', 'M', 2);
  items = add(items, polo, 'Rosa', 'L', 1);
  const totals = cartTotals(items);
  assert.equal(items[0].unitPrice * items[0].quantity, 2500);
  assert.equal(items[1].unitPrice * items[1].quantity, 1500);
  assert.equal(totals.subtotal, 4000);
  assert.equal(totals.total, 4000);
  assert.equal(totals.quantity, 3);
  assert.equal(totals.deliveryFee, null);
});

test('adicionar a mesma variante soma quantidades até ao stock', () => {
  let items = add([], tee, 'Verde', 'XL', 1);
  items = add(items, tee, 'Verde', 'XL', 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2);
  assert.throws(() => add(items, tee, 'Verde', 'XL', 1), { code: 'STOCK_LIMIT' });
});

test('stock = 1 permite 1 e bloqueia 2; stock = 0 bloqueia', () => {
  assert.equal(add([], polo, 'Rosa', 'L', 1)[0].quantity, 1);
  assert.throws(() => add([], polo, 'Rosa', 'L', 2), { code: 'STOCK_LIMIT' });
  assert.throws(() => add([], polo, 'Rosa', 'XL', 1), { code: 'SOLD_OUT' });
  assert.throws(() => add([], byslug(products, 'seven-street-tee'), 'Preto', 'M', 1), { code: 'SOLD_OUT' });
});

test('sem tamanho, quantidade inválida, produto personalizado', () => {
  assert.throws(() => addToCart([], products, { productId: tee.id, variantId: null, quantity: 1 }), { code: 'VARIANT_REQUIRED', message: 'Seleciona um tamanho.' });
  assert.throws(() => add([], tee, 'Verde', 'M', 0), { code: 'INVALID_QUANTITY' });
  assert.throws(() => add([], tee, 'Verde', 'M', 1.5), { code: 'INVALID_QUANTITY' });
  assert.throws(() => add([], tee, 'Verde', 'M', -2), { code: 'INVALID_QUANTITY' });
  const custom = byslug(products, 'sacola-personalizada');
  assert.throws(() => addToCart([], products, { productId: custom.id, variantId: custom.variants[0].id }), { code: 'PRODUCT_UNAVAILABLE' });
});

test('alterar quantidade respeita mínimo 1 e máximo stock; remover', () => {
  let items = add([], tee, 'Verde', 'XL', 1);
  const id = items[0].variantId;
  items = setCartQuantity(items, products, id, 2);
  assert.equal(items[0].quantity, 2);
  assert.throws(() => setCartQuantity(items, products, id, 3), { code: 'STOCK_LIMIT' });
  assert.throws(() => setCartQuantity(items, products, id, 0), { code: 'INVALID_QUANTITY' });
  assert.deepEqual(removeFromCart(items, id), []);
});

test('reconcile remove esgotados, ajusta stock e atualiza preços', () => {
  let items = add([], tee, 'Verde', 'M', 5);
  items = add(items, polo, 'Rosa', 'L', 1);
  const updated = demoProducts();
  const updatedTee = byslug(updated, 't-shirt-seven');
  variantOf(updatedTee, 'Verde', 'M').stock = 3;
  updatedTee.basePrice = 1300;
  variantOf(byslug(updated, 'polo-seven'), 'Rosa', 'L').stock = 0;
  const { items: next, changes } = reconcileCart(items, updated);
  assert.equal(next.length, 1);
  assert.equal(next[0].quantity, 3);
  assert.equal(next[0].unitPrice, 1300);
  assert.deepEqual(changes.map(change => change.type).sort(), ['price', 'quantity', 'removed']);
});

test('dados corrompidos no storage são descartados', () => {
  assert.deepEqual(sanitizeStoredItems('lixo'), []);
  assert.equal(sanitizeStoredItems([{ productId: 'a', variantId: 'b', quantity: 0 }, { productId: 'a', variantId: 'b', quantity: 2, unitPrice: -5 }]).length, 1);
  assert.equal(sanitizeStoredItems([{ productId: 'a', variantId: 'b', quantity: 2, unitPrice: -5 }])[0].unitPrice, null);
});

test('store persiste entre instâncias (refresh) e revalida ao carregar produtos', () => {
  const storage = memoryStorage();
  const first = createCartStore({ storage, target: null });
  first.setProducts(products);
  first.add(signature.id, variantOf(signature, 'Preto', 'M').id, 2);
  const reloaded = createCartStore({ storage, target: null });
  assert.equal(reloaded.getState().totals.quantity, 2);
  const changes = reloaded.setProducts(products);
  assert.deepEqual(changes, []);
  assert.equal(reloaded.getState().totals.subtotal, 2500);
  reloaded.clear();
  assert.equal(createCartStore({ storage, target: null }).getState().totals.quantity, 0);
});

test('revalidar sem alterações não volta a gravar (não dispara "storage" noutros separadores)', () => {
  const storage = memoryStorage();
  const first = createCartStore({ storage, target: null });
  first.setProducts(products);
  first.add(signature.id, variantOf(signature, 'Preto', 'M').id, 2);
  const saved = storage.getItem('gsl-cart-v2');
  let writes = 0;
  const spy = { ...storage, setItem: (key, value) => { writes += 1; storage.setItem(key, value); } };
  const reloaded = createCartStore({ storage: spy, target: null });
  const reasons = [];
  reloaded.subscribe((state, detail) => reasons.push(detail.reason));
  reloaded.setProducts(products);
  assert.equal(writes, 0);
  assert.equal(storage.getItem('gsl-cart-v2'), saved);
  assert.deepEqual(reasons, ['reconcile']);
  assert.equal(reloaded.productsLoaded, true);
  // Preço mudou no catálogo → o pedido revalidado é gravado.
  const updated = demoProducts();
  byslug(updated, 'seven-signature').basePrice = 1300;
  variantOf(byslug(updated, 'seven-signature'), 'Preto', 'M').priceOverride = null;
  reloaded.setProducts(updated);
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.getItem('gsl-cart-v2')).items[0].unitPrice, 1300);
});

test('templates do pedido: nível do título do estado vazio e nome completo da linha', () => {
  assert.ok(emptyOrderHTML().includes('<h3>O teu pedido está vazio.</h3>'));
  assert.ok(emptyOrderHTML({ heading: 'h2' }).includes('<h2>O teu pedido está vazio.</h2>'));
  const [line] = add([], polo, 'Rosa', 'L', 1);
  assert.equal(cartLineLabel(line), 'Polo Seven Rosa / L');
});

test('rascunho do pedido guarda snapshots e total', () => {
  let items = add([], signature, 'Preto', 'M', 2);
  items = add(items, polo, 'Rosa', 'L', 1);
  const draft = buildOrderDraft(items, { name: 'João Mussa', phone: '841234567', location: 'Maputo', deliveryType: 'entrega', notes: '' });
  assert.equal(draft.total, 4000);
  assert.equal(draft.items[0].name, 'Seven Signature');
  assert.equal(draft.items[0].subtotal, 2500);
  assert.equal(draft.customer.deliveryLabel, 'Entrega');
  assert.throws(() => buildOrderDraft([], { deliveryType: 'entrega' }));
});
