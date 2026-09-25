// Produtos: tabela com pesquisa e filtros por categoria/estado.
import { SITE_CONFIG } from '/config/site.js';
import { pluralize } from '/js/lib/format.js';
import { escapeHTML } from '/js/lib/html.js';
import { PRODUCT_STATUSES, dbErrorMessage, filterProductRows, productListRow } from './logic.js';
import { debounce, emptyHTML, loadInto, optionsHTML, productStatusChip, tableHTML, thumbHTML } from './ui.js';

function productsTableHTML(rows) {
  return tableHTML({
    caption: 'Produtos',
    columns: [
      { label: 'Imagem', className: 'col-thumb' }, { label: 'Nome' }, { label: 'Categoria' },
      { label: 'Preço', className: 'num' }, { label: 'Stock', className: 'num' }, { label: 'Estado' }, { label: 'Destaque' }
    ],
    rows: rows.map(row => [
      { html: thumbHTML(row.thumb) },
      { html: `<a class="strong-link" href="#/produtos/${encodeURIComponent(row.id)}">${escapeHTML(row.name || '(sem nome)')}</a><span class="cell-sub">/produtos/${escapeHTML(row.slug)}</span>` },
      { html: escapeHTML(row.categoryLabel || '—') },
      { html: row.basePrice === null ? '<span class="muted">Sem preço</span>' : escapeHTML(row.priceLabel) },
      { html: escapeHTML(row.stockLabel) },
      { html: productStatusChip(row.status) },
      { html: row.featured ? '<span class="featured">★ Sim</span>' : '<span class="muted">Não</span>' }
    ])
  });
}

export function renderProducts(ctx) {
  ctx.setTitle('Produtos');
  const initialStatus = PRODUCT_STATUSES.some(status => status.id === ctx.route.query.estado) ? ctx.route.query.estado : '';
  const categories = SITE_CONFIG.categories.map(category => ({ value: category.id, label: category.label }));
  const statuses = PRODUCT_STATUSES.map(status => ({ value: status.id, label: status.label }));

  ctx.main.innerHTML = `
    <div class="page-head">
      <h1 tabindex="-1">Produtos</h1>
      <a class="btn btn-primary" href="#/produtos/novo">+ Novo produto</a>
    </div>
    <form class="toolbar" role="search" aria-label="Filtrar produtos" data-filters>
      <div class="field field-grow">
        <label for="products-q">Pesquisar</label>
        <input id="products-q" name="q" type="search" placeholder="Nome, slug, tipo ou etiqueta" autocomplete="off">
      </div>
      <div class="field">
        <label for="products-category">Categoria</label>
        <select id="products-category" name="category">${optionsHTML([{ value: '', label: 'Todas' }, ...categories], '')}</select>
      </div>
      <div class="field">
        <label for="products-status">Estado</label>
        <select id="products-status" name="status">${optionsHTML([{ value: '', label: 'Todos' }, ...statuses], initialStatus)}</select>
      </div>
    </form>
    <p class="result-count" aria-live="polite" data-count></p>
    <div data-region></div>`;

  const form = ctx.main.querySelector('[data-filters]');
  const region = ctx.main.querySelector('[data-region]');
  const count = ctx.main.querySelector('[data-count]');
  let rows = null;

  const announce = debounce(text => { count.textContent = text; }, 400);

  function paint() {
    if (!rows) return;
    const filters = { q: form.elements.q.value, category: form.elements.category.value, status: form.elements.status.value };
    const visible = filterProductRows(rows, filters);
    if (!rows.length) {
      region.innerHTML = emptyHTML('Sem produtos ainda.', '<p><a class="btn btn-primary" href="#/produtos/novo">Criar o primeiro produto</a></p>');
    } else if (!visible.length) {
      region.innerHTML = emptyHTML('Nenhum produto corresponde aos filtros.');
    } else {
      region.innerHTML = productsTableHTML(visible);
    }
    announce(rows.length ? `${pluralize(visible.length, 'produto', 'produtos')} de ${rows.length}.` : '');
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', paint);

  loadInto(region, {
    load: () => ctx.api.listProducts(),
    isAlive: ctx.alive,
    loadingText: 'A carregar produtos…',
    errorMessage: error => `Não foi possível carregar os produtos. ${dbErrorMessage(error)}`,
    render: data => {
      rows = data.map(productListRow);
      paint();
    }
  });

  return () => announce.cancel();
}
