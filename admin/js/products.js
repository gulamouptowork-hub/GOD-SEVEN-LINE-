// Produtos: tabela com pesquisa, filtros por categoria/estado e ações (editar / apagar) por linha.
import { SITE_CONFIG } from '/config/site.js';
import { pluralize } from '/js/lib/format.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  PRODUCT_STATUSES, SALE_STATES, STORAGE_CLEANUP_NOTE, dbErrorMessage, filterProductRows, productDeleteConfirmation, productListRow
} from './logic.js';
import { chipHTML, debounce, emptyHTML, loadInto, optionsHTML, productStatusChip, tableHTML, thumbHTML } from './ui.js';

// Estado + como aparece na loja (carrinho, só WhatsApp…) com o que falta, para se ver logo o que corrigir.
function statusCellHTML(row) {
  const missing = row.sale.missing.filter(item => item.key !== 'status').map(item => item.short);
  return `<div class="cell-stack">${productStatusChip(row.status)}${chipHTML(`Na loja: ${row.sale.short}`, row.sale.tone, ` title="${escapeHTML(row.sale.label)}"`)}`
    + `${missing.length ? `<span class="cell-sub">Falta: ${escapeHTML(missing.join(', '))}</span>` : ''}</div>`;
}

function actionsHTML(row, deleting) {
  const href = `#/produtos/${encodeURIComponent(row.id)}`;
  const name = escapeHTML(row.name || '(sem nome)');
  const busy = deleting.has(row.id);
  return `<div class="cell-actions">`
    + `<a class="btn btn-small" href="${href}">Editar<span class="sr-only"> ${name}</span></a>`
    + `<button type="button" class="btn btn-small btn-danger-ghost" data-delete="${escapeHTML(row.id)}"${busy ? ' disabled' : ''}>`
    + `${busy ? 'A apagar…' : 'Apagar'}<span class="sr-only"> ${name}</span></button>`
    + `</div>`;
}

function productsTableHTML(rows, deleting) {
  return tableHTML({
    caption: 'Produtos',
    columns: [
      { label: 'Imagem', className: 'col-thumb' }, { label: 'Nome' }, { label: 'Categoria' },
      { label: 'Preço', className: 'num' }, { label: 'Stock', className: 'num' }, { label: 'Estado' }, { label: 'Destaque' },
      { label: 'Ações', className: 'col-actions' }
    ],
    rows: rows.map(row => [
      { html: thumbHTML(row.thumb) },
      { html: `<a class="strong-link" href="#/produtos/${encodeURIComponent(row.id)}">${escapeHTML(row.name || '(sem nome)')}</a><span class="cell-sub">/produtos/${escapeHTML(row.slug)}</span>` },
      { html: escapeHTML(row.categoryLabel || '—') },
      { html: row.basePrice === null ? '<span class="muted">Sem preço</span>' : escapeHTML(row.priceLabel) },
      { html: escapeHTML(row.stockLabel) },
      { html: statusCellHTML(row) },
      { html: row.featured ? '<span class="featured">★ Sim</span>' : '<span class="muted">Não</span>' },
      { html: actionsHTML(row, deleting) }
    ])
  });
}

export function renderProducts(ctx) {
  ctx.setTitle('Produtos');
  const initialStatus = PRODUCT_STATUSES.some(status => status.id === ctx.route.query.estado) ? ctx.route.query.estado : '';
  const categories = SITE_CONFIG.categories.map(category => ({ value: category.id, label: category.label }));
  const statuses = PRODUCT_STATUSES.map(status => ({ value: status.id, label: status.label }));
  const saleOptions = SALE_STATES.map(state => ({ value: state.id, label: state.label }));
  const initialSale = SALE_STATES.some(state => state.id === ctx.route.query.loja) ? ctx.route.query.loja : '';

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
      <div class="field">
        <label for="products-sale">Na loja</label>
        <select id="products-sale" name="sale">${optionsHTML([{ value: '', label: 'Todas' }, ...saleOptions], initialSale)}</select>
      </div>
    </form>
    <p class="result-count" aria-live="polite" data-count></p>
    <div data-region></div>`;

  const form = ctx.main.querySelector('[data-filters]');
  const region = ctx.main.querySelector('[data-region]');
  const count = ctx.main.querySelector('[data-count]');
  const heading = ctx.main.querySelector('h1');
  const deleting = new Set();
  let rows = null;

  const announce = debounce(text => { count.textContent = text; }, 400);

  function paint() {
    if (!rows) return;
    const filters = { q: form.elements.q.value, category: form.elements.category.value, status: form.elements.status.value, sale: form.elements.sale.value };
    const visible = filterProductRows(rows, filters);
    if (!rows.length) {
      region.innerHTML = emptyHTML('Sem produtos ainda.', '<p><a class="btn btn-primary" href="#/produtos/novo">Criar o primeiro produto</a></p>');
    } else if (!visible.length) {
      region.innerHTML = emptyHTML('Nenhum produto corresponde aos filtros.');
    } else {
      region.innerHTML = productsTableHTML(visible, deleting);
    }
    announce(rows.length ? `${pluralize(visible.length, 'produto', 'produtos')} de ${rows.length}.` : '');
  }

  // O botão apagado desaparece: o foco passa para o "Apagar" da linha seguinte (ou anterior), senão para o título.
  function focusAfterRemoval(index) {
    const buttons = [...region.querySelectorAll('[data-delete]:not([disabled])')];
    (buttons[index] ?? buttons[index - 1] ?? heading).focus();
  }

  async function removeProduct(button) {
    const id = button.dataset.delete;
    const row = rows?.find(item => item.id === id);
    if (!row || deleting.has(id)) return;
    const name = row.name.trim() || 'este produto';
    if (!window.confirm(productDeleteConfirmation(name))) return;
    const index = [...region.querySelectorAll('[data-delete]')].indexOf(button);
    deleting.add(id);
    paint();
    ctx.flash(`A apagar “${name}”…`, 'info');

    try {
      await ctx.api.deleteProduct(id);
    } catch (error) {
      console.error(error);
      deleting.delete(id);
      if (!ctx.alive()) return;
      paint();
      ctx.flash(`Não foi possível apagar “${name}”. ${dbErrorMessage(error)}`, 'error');
      region.querySelector(`[data-delete="${CSS.escape(id)}"]`)?.focus();
      return;
    }

    let message = `Produto “${name}” apagado.`;
    try {
      await ctx.api.removeProductFolder(id);
    } catch (error) {
      console.warn('Limpeza do Storage falhou', error);
      message += STORAGE_CLEANUP_NOTE;
    }
    deleting.delete(id);
    rows = rows.filter(item => item.id !== id);
    if (!ctx.alive()) return;
    paint();
    ctx.flash(message, 'success');
    focusAfterRemoval(index);
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', paint);
  region.addEventListener('click', event => {
    const button = event.target.closest('[data-delete]');
    if (button && !button.disabled) removeProduct(button);
  });

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
