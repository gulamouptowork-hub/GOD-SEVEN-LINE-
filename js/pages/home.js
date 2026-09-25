// Homepage: o NEW DROP é gerado no build; aqui atualiza-se com os dados ao vivo (preço/stock/etiquetas).
import { catalog } from '../app-context.js';
import { productGridHTML } from '../ui/templates.js';

export async function init() {
  const grid = document.querySelector('[data-featured-grid]');
  if (!grid) return;
  try {
    const { products } = await catalog();
    const featured = products.filter(product => product.featured).slice(0, 4);
    if (!featured.length) return;
    const html = productGridHTML(featured);
    if (grid.dataset.signature !== html) {
      grid.innerHTML = html;
      grid.dataset.signature = html;
    }
  } catch {
    // Sem dados ao vivo, os cartões gerados no build continuam visíveis.
  }
}
