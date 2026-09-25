// Fonte única de verdade do pedido no browser.
// Persistência em localStorage (sobrevive a refresh e mudança de página) e sincronização entre separadores.
// A API é propositadamente pequena para, no futuro, trocar o storage por um carrinho no backend.
import { SITE_CONFIG } from '../../config/site.js';
import {
  addToCart, cartLines, cartTotals, reconcileCart, removeFromCart, sanitizeStoredItems, setCartQuantity
} from '../lib/cart.js';

const VERSION = 2;

function safeStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = '__gsl__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    const memory = new Map();
    return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
  }
}

export function createCartStore({ storage = safeStorage(), key = SITE_CONFIG.storageKeys.cart, target = globalThis } = {}) {
  let items = read();
  let products = [];
  let productsLoaded = false;
  const listeners = new Set();

  function read() {
    try {
      const data = JSON.parse(storage.getItem(key) ?? 'null');
      return data?.v === VERSION ? sanitizeStoredItems(data.items) : [];
    } catch { return []; }
  }

  function write() {
    try { storage.setItem(key, JSON.stringify({ v: VERSION, items, updatedAt: new Date().toISOString() })); }
    catch { /* storage cheio ou bloqueado: o pedido continua em memória nesta página */ }
  }

  function emit(reason, detail = {}) {
    const state = api.getState();
    listeners.forEach(listener => listener(state, { reason, ...detail }));
  }

  function commit(next, reason, detail) {
    items = next;
    write();
    emit(reason, detail);
  }

  const api = {
    getState() {
      const lines = cartLines(items, products);
      return { items: lines, totals: cartTotals(items), productsLoaded };
    },
    getItems: () => items.slice(),
    get productsLoaded() { return productsLoaded; },

    // Recebe o catálogo atual e revalida o pedido. Devolve as alterações (para avisar o cliente).
    setProducts(nextProducts) {
      products = nextProducts;
      productsLoaded = true;
      const result = reconcileCart(items, products);
      commit(result.items, 'reconcile', { changes: result.changes });
      return result.changes;
    },

    add(productId, variantId, quantity) {
      if (!productsLoaded) throw new Error('O catálogo ainda está a carregar. Tenta novamente.');
      const next = addToCart(items, products, { productId, variantId, quantity });
      commit(next, 'add', { productId, variantId, quantity });
      return next.find(item => item.variantId === variantId);
    },

    setQuantity(variantId, quantity) {
      commit(setCartQuantity(items, productsLoaded ? products : [], variantId, quantity), 'quantity', { variantId, quantity });
    },

    remove(variantId) {
      const removed = items.find(item => item.variantId === variantId);
      commit(removeFromCart(items, variantId), 'remove', { variantId, removed });
      return removed;
    },

    clear() { commit([], 'clear'); },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  // Outro separador alterou o pedido → recarregar e revalidar.
  target?.addEventListener?.('storage', event => {
    if (event.key !== key) return;
    items = read();
    if (productsLoaded) items = reconcileCart(items, products).items;
    emit('sync');
  });

  return api;
}
