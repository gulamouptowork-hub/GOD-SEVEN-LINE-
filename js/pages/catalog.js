// Coleção: filtros, pesquisa e ordenação sem recarregar a página. O estado vive no URL (partilhável).
import { catalog } from '../app-context.js';
import { SITE_CONFIG } from '../../config/site.js';
import { EMPTY_FILTERS, SORT_OPTIONS, categoryFromParam, filterProducts, sortProducts } from '../lib/catalog.js';
import { $, $$, on } from '../ui/dom.js';
import { openModal } from '../ui/dialogs.js';
import { productGridHTML } from '../ui/templates.js';

const PARAMS = { category: 'categoria', size: 'tamanho', availability: 'disponibilidade', price: 'preco', q: 'q', sort: 'ordem' };

function readState() {
  const params = new URLSearchParams(location.search);
  const pick = (key, allowed) => {
    const value = params.get(PARAMS[key]) ?? '';
    return allowed.includes(value) ? value : '';
  };
  return {
    category: categoryFromParam(params.get(PARAMS.category)),
    size: pick('size', SITE_CONFIG.sizes),
    availability: pick('availability', ['available', 'soldout']),
    price: pick('price', SITE_CONFIG.priceRanges.map(range => range.id)),
    q: (params.get(PARAMS.q) ?? '').slice(0, 80),
    sort: pick('sort', SORT_OPTIONS.map(option => option.id)) || 'recent'
  };
}

function writeState(state) {
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(PARAMS)) {
    const value = state[key];
    if (value && !(key === 'sort' && value === 'recent')) params.set(name, value);
  }
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

export async function init() {
  const root = $('[data-catalog]');
  if (!root) return;
  const grid = $('[data-catalog-grid]', root);
  const count = $('[data-result-count]', root);
  const empty = $('[data-catalog-empty]', root);
  const error = $('[data-catalog-error]', root);
  const panel = $('[data-filters-panel]', root);
  const slot = $('[data-filters-slot]', root);
  const dialog = $('[data-filters-dialog]');
  const dialogSlot = $('[data-filters-dialog-slot]');
  const filterCount = $('[data-filter-count]', root);
  const applyButton = $('[data-filters-apply]');
  let products = [];
  let state = readState();
  let lastRendered = '';

  const controls = () => ({
    q: $('[data-filter="q"]', root),
    size: $('[data-filter="size"]'),
    availability: $('[data-filter="availability"]'),
    price: $('[data-filter="price"]'),
    sort: $('[data-sort]', root)
  });

  function syncControls() {
    const fields = controls();
    fields.q.value = state.q;
    fields.size.value = state.size;
    fields.availability.value = state.availability;
    fields.price.value = state.price;
    fields.sort.value = state.sort;
    $$('[data-category]', root).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === state.category)));
  }

  function apply({ animate = true } = {}) {
    const filtered = sortProducts(filterProducts(products, state), state.sort);
    // h2: os cartões ficam logo sob o h1 "Coleção." (igual ao HTML gerado no build).
    const html = productGridHTML(filtered, { eager: true, heading: 'h2' });
    if (html !== lastRendered) {
      grid.innerHTML = html;
      if (!animate) grid.querySelectorAll('.product-card').forEach(card => { card.style.animation = 'none'; });
      lastRendered = html;
    }
    const label = `${filtered.length} ${filtered.length === 1 ? 'peça' : 'peças'}`;
    count.textContent = label;
    if (applyButton) applyButton.textContent = `Ver ${label}`;
    grid.hidden = filtered.length === 0;
    empty.hidden = filtered.length !== 0;
    const panelFilters = ['size', 'availability', 'price'].filter(key => state[key]).length;
    filterCount.hidden = panelFilters === 0;
    filterCount.textContent = String(panelFilters);
    const any = panelFilters > 0 || state.category || state.q;
    $$('.catalog-meta [data-clear-filters]', root).forEach(button => { button.hidden = !any; });
    writeState(state);
  }

  function update(changes) {
    state = { ...state, ...changes };
    apply();
  }

  function clearAll() {
    state = { ...EMPTY_FILTERS, sort: state.sort };
    syncControls();
    apply();
  }

  on(root, 'click', '[data-category]', (event, button) => {
    update({ category: button.dataset.category });
    $$('[data-category]', root).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });
  let searchTimer;
  controls().q.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => update({ q: event.target.value.trim() }), 160);
  });
  controls().q.addEventListener('search', event => update({ q: event.target.value.trim() }));
  for (const key of ['size', 'availability', 'price']) controls()[key].addEventListener('change', event => update({ [key]: event.target.value }));
  controls().sort.addEventListener('change', event => update({ sort: event.target.value }));
  on(document, 'click', '[data-clear-filters]', (event, button) => {
    clearAll();
    // O botão usado pode ter ficado escondido (já não há filtros): o foco passa para "Todos" em vez de cair no <body>.
    if (button.closest('[hidden]')) $('[data-category=""]', root)?.focus();
  });

  // Mobile: os mesmos controlos são movidos para uma gaveta nativa (sem duplicar estado).
  $('[data-filters-open]', root)?.addEventListener('click', () => {
    dialogSlot.append(panel);
    openModal(dialog, { focus: 'select' });
  });
  dialog?.addEventListener('close', () => slot.append(panel));

  $('[data-retry]', root)?.addEventListener('click', () => load());

  async function load() {
    error.hidden = true;
    grid.setAttribute('aria-busy', 'true');
    try {
      ({ products } = await catalog());
      grid.hidden = false;
      syncControls();
      apply({ animate: false });
    } catch {
      error.hidden = false;
      grid.hidden = true;
      empty.hidden = true;
      count.textContent = '';
    } finally {
      grid.removeAttribute('aria-busy');
    }
  }

  syncControls();
  await load();
}
