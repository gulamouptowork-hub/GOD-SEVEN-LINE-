// Estado partilhado da loja no browser: um único pedido e um único pedido de catálogo por página.
import { loadProducts } from './services/products.js';
import { createCartStore } from './store/cart-store.js';

export const cart = createCartStore();

let pending = null;

// Carrega (uma vez) os produtos ativos e revalida o pedido guardado contra eles.
// fresh=true volta a pedir ao servidor — usado antes de finalizar.
export function catalog({ fresh = false } = {}) {
  if (!pending || fresh) {
    const request = loadProducts({ fresh }).then(products => ({ products, changes: cart.setProducts(products) }));
    request.catch(() => { if (pending === request) pending = null; });
    pending = request;
  }
  return pending;
}
