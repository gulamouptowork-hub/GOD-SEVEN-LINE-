// Ponto de entrada da loja pública (todas as páginas).
import { catalog } from './app-context.js';
import { setupCartUI } from './ui/cart-drawer.js';
import { setupDialogs } from './ui/dialogs.js';
import { setupHeader } from './ui/header.js';
import { setupReveal } from './ui/reveal.js';
import { setupSearch } from './ui/search.js';

setupDialogs();
setupHeader();
setupCartUI();
setupSearch();
setupReveal();

// Revalida o pedido guardado assim que o catálogo chega (erros são tratados por cada página).
catalog().catch(() => {});

const PAGES = {
  home: () => import('./pages/home.js'),
  catalog: () => import('./pages/catalog.js'),
  product: () => import('./pages/product.js'),
  checkout: () => import('./pages/checkout.js')
};
const loader = PAGES[document.body.dataset.page];
if (loader) loader().then(module => module.init()).catch(error => console.error('[God Seven Line]', error));
