import { catalog } from '../app-context.js';
import { filterProducts, productPriceLabel, productURL } from '../lib/catalog.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML } from '../lib/images.js';
import { $, on } from './dom.js';
import { openModal } from './dialogs.js';
import { icon } from './templates.js';

const resultHTML = product => `<li><a class="search-result" href="${productURL(product)}">
  ${imgHTML(product.images[0]?.src, { alt: '', sizes: '56px' })}
  <span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.productType)} · ${escapeHTML(productPriceLabel(product))}</small></span>
  ${icon('arrow')}
</a></li>`;

export function setupSearch() {
  const dialog = $('[data-search-dialog]');
  if (!dialog) return;
  const input = $('[data-search-input]', dialog);
  const results = $('[data-search-results]', dialog);
  let products = [];
  let timer;

  const render = () => {
    const query = input.value.trim();
    if (!products.length) { results.innerHTML = '<p class="search-dialog__empty">A carregar a coleção…</p>'; return; }
    if (!query) {
      const featured = products.filter(product => product.featured).slice(0, 4);
      results.innerHTML = `<p class="eyebrow" style="margin:18px 0 0">Destaques</p><ul>${featured.map(resultHTML).join('')}</ul>`;
      return;
    }
    const matches = filterProducts(products, { q: query });
    results.innerHTML = matches.length
      ? `<ul>${matches.slice(0, 6).map(resultHTML).join('')}</ul><p class="search-dialog__all"><a href="/produtos?q=${encodeURIComponent(query)}">Ver ${matches.length === 1 ? 'o resultado' : `os ${matches.length} resultados`} na coleção →</a></p>`
      : '<p class="search-dialog__empty">Nenhuma peça encontrada. Experimenta "polo", "t-shirt" ou uma cor.</p>';
  };

  on(document, 'click', '[data-search-open]', () => {
    openModal(dialog, { focus: input });
    render();
    catalog().then(result => { products = result.products; render(); })
      .catch(() => { results.innerHTML = '<p class="search-dialog__empty">Não foi possível carregar os produtos. Tenta novamente.</p>'; });
  });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  // Num input type=search o primeiro Esc só limpa o texto; aqui fecha logo a pesquisa.
  input.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dialog.close();
  });
}
