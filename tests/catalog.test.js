import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  categoryFromParam, filterProducts, isNewProduct, normalizeProduct, productAvailability, productBadge, productColors,
  productPriceLabel, sortProducts, validateCatalog, variantPrice, variantStatus, variantsForColor
} from '../js/lib/catalog.js';
import { byslug, demoProducts, realProducts, variantOf } from './helpers.js';

const now = new Date('2026-09-25T12:00:00Z');

test('o catálogo real e o de demonstração são válidos', () => {
  for (const file of ['../data/products.json', './fixtures/products.demo.json']) {
    const raw = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.deepEqual(validateCatalog(raw), [], file);
  }
});

test('o catálogo real não inventa preços nem stock', () => {
  for (const product of realProducts()) {
    assert.equal(product.basePrice, null, product.slug);
    for (const variant of product.variants) assert.equal(variant.stock, null, variant.id);
    assert.equal(productPriceLabel(product), 'Preço sob consulta');
  }
});

test('validateCatalog deteta slugs duplicados, preços negativos e stock inválido', () => {
  const errors = validateCatalog([
    { id: 'a', slug: 'x', name: 'A', category: 'polos', basePrice: -1, images: ['a'], variants: [{ id: 'v', stock: 1.5 }] },
    { id: 'b', slug: 'x', name: 'B', category: 'inexistente', images: [], variants: [{ id: 'v' }] }
  ]);
  assert.ok(errors.some(error => error.includes('preço base inválido')));
  assert.ok(errors.some(error => error.includes('stock inválido')));
  assert.ok(errors.some(error => error.includes('slug duplicado')));
  assert.ok(errors.some(error => error.includes('categoria desconhecida')));
  assert.ok(errors.some(error => error.includes('id de variante duplicado')));
});

test('preço final = price_override ?? base_price', () => {
  const signature = byslug(demoProducts(), 'seven-signature');
  assert.equal(variantPrice(signature, variantOf(signature, 'Preto', 'M')), 1250);
  assert.equal(variantPrice(signature, variantOf(signature, 'Preto', 'XXL')), 1350);
  assert.equal(productPriceLabel(signature), 'Desde 1.250 MT');
  assert.equal(productPriceLabel(byslug(demoProducts(), 'polo-seven')), '1.500 MT');
});

test('estado por variante: esgotado, últimas unidades, disponível, por configurar', () => {
  const tee = byslug(demoProducts(), 't-shirt-seven');
  assert.equal(variantStatus(tee, variantOf(tee, 'Verde', 'XXL')), 'soldout');
  assert.equal(variantStatus(tee, variantOf(tee, 'Verde', 'XL')), 'low');
  assert.equal(variantStatus(tee, variantOf(tee, 'Verde', 'M')), 'available');
  const real = byslug(realProducts(), 't-shirt-seven');
  assert.equal(variantStatus(real, real.variants[0]), 'unconfigured');
});

test('disponibilidade e etiqueta do produto', () => {
  const products = demoProducts();
  assert.equal(productAvailability(byslug(products, 'seven-street-tee')).state, 'soldout');
  assert.equal(productBadge(byslug(products, 'seven-street-tee'), now).label, 'ESGOTADO');
  assert.equal(productBadge(byslug(products, 'polo-seven'), now).label, 'NOVO');
  assert.equal(productBadge(byslug(products, 'polo-seven'), new Date('2027-01-01')).label, 'IDENTIDADE');
  assert.equal(productAvailability(byslug(products, 'a-tua-estampa')).state, 'custom');
  assert.equal(productAvailability(byslug(realProducts(), 'polo-seven')).state, 'unconfigured');
  assert.equal(isNewProduct({ createdAt: null }, now), false);
});

test('cores e tamanhos ordenados', () => {
  const polo = byslug(demoProducts(), 'polo-seven');
  assert.deepEqual(productColors(polo).map(color => color.name), ['Rosa', 'Vermelho']);
  assert.deepEqual(variantsForColor(polo, 'Rosa').map(variant => variant.size), ['S', 'M', 'L', 'XL', 'XXL']);
});

test('filtros: categoria, tamanho, disponibilidade, preço e pesquisa sem acentos', () => {
  const products = demoProducts();
  const slugs = list => list.map(product => product.slug).sort();
  assert.deepEqual(slugs(filterProducts(products, { category: 'polos' })), ['polo-seven', 'seven-signature']);
  assert.deepEqual(slugs(filterProducts(products, { category: 'hoodies' })), []);
  assert.deepEqual(slugs(filterProducts(products, { availability: 'soldout' })), ['seven-street-tee']);
  assert.ok(!filterProducts(products, { size: 'XXL' }).some(product => product.slug === 't-shirt-seven'));
  assert.deepEqual(slugs(filterProducts(products, { price: '1000-2000' })), ['polo-seven', 'seven-signature', 'seven-street-tee', 't-shirt-seven']);
  assert.deepEqual(slugs(filterProducts(products, { q: 'personalizacao' })), ['a-tua-estampa']);
  assert.deepEqual(slugs(filterProducts(products, { q: 'polo rosa' })), ['polo-seven']);
});

test('faixas de preço: preços redondos ficam na faixa do rótulo', () => {
  const priced = price => normalizeProduct({
    id: `p${price}`, slug: `p${price}`, name: `P${price}`, category: 'polos', basePrice: price, status: 'active',
    images: ['a'], variants: [{ id: `p${price}-m`, size: 'M', stock: 3 }]
  });
  const products = [0, 999, 1000, 1000.5, 2000, 2001].map(priced);
  const ids = price => filterProducts(products, { price }).map(product => product.id);
  assert.deepEqual(ids('ate-1000'), ['p0', 'p999', 'p1000']);
  assert.deepEqual(ids('1000-2000'), ['p1000.5', 'p2000']);
  assert.deepEqual(ids('mais-2000'), ['p2001']);
});

test('ordenação por preço, nome e mais recentes', () => {
  const products = demoProducts();
  assert.equal(sortProducts(products, 'price-desc')[0].slug, 'polo-seven');
  assert.equal(sortProducts(products, 'price-asc').at(-1).slug, 'sacola-personalizada');
  assert.equal(sortProducts(products, 'name')[0].slug, 'a-tua-estampa');
  assert.equal(sortProducts(products, 'recent')[0].slug, 'polo-seven');
});

test('categoria a partir de parâmetros antigos e novos', () => {
  assert.equal(categoryFromParam('T-shirts'), 't-shirts');
  assert.equal(categoryFromParam('Acessórios'), 'acessorios');
  assert.equal(categoryFromParam('todos'), '');
  assert.equal(categoryFromParam('xyz'), '');
});
