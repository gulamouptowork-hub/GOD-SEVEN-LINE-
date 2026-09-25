import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatNumber, formatPrice } from '../js/lib/format.js';

test('formatPrice formata meticais com separador de milhares', () => {
  assert.equal(formatPrice(1250), '1.250 MT');
  assert.equal(formatPrice(2500), '2.500 MT');
  assert.equal(formatPrice(4000), '4.000 MT');
  assert.equal(formatPrice(950), '950 MT');
  assert.equal(formatPrice(0), '0 MT');
  assert.equal(formatPrice(1250000), '1.250.000 MT');
  assert.equal(formatPrice(1250.5), '1.250,50 MT');
});

test('formatPrice rejeita valores inválidos ou negativos', () => {
  assert.equal(formatPrice(null), '');
  assert.equal(formatPrice(undefined, '—'), '—');
  assert.equal(formatPrice(-10), '');
  assert.equal(formatPrice(Number.NaN), '');
  assert.equal(formatPrice('1250'), '');
});

test('formatNumber e formatDate', () => {
  assert.equal(formatNumber(12345), '12.345');
  assert.equal(formatDate(new Date(2026, 8, 25)), '25/09/2026');
  assert.equal(formatDate('lixo'), '');
});
