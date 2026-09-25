import fs from 'node:fs';
import { normalizeProduct } from '../js/lib/catalog.js';

export function demoProducts() {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/products.demo.json', import.meta.url), 'utf8'));
  return raw.map(normalizeProduct);
}

export function realProducts() {
  const raw = JSON.parse(fs.readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
  return raw.map(normalizeProduct);
}

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    dump: () => Object.fromEntries(map)
  };
}

export const byslug = (products, slug) => products.find(product => product.slug === slug);
export const variantOf = (product, color, size) => product.variants.find(variant => variant.color === color && variant.size === size);
