// Pedidos: lista (filtro, pesquisa, "carregar mais") e detalhe (cliente, itens, estado, WhatsApp).
import { SITE_CONFIG, orderStatusLabel } from '/config/site.js';
import { formatDate, formatDateTime, formatPrice, pluralize } from '/js/lib/format.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  ORDERS_PAGE_SIZE, dbErrorMessage, isOrderStatus, isUuid, orderDetailFromDb, orderListRow
} from './logic.js';
import { debounce, emptyHTML, errorHTML, loadInto, optionsHTML, orderStatusChip, tableHTML } from './ui.js';

const STATUS_OPTIONS = SITE_CONFIG.orderStatuses.map(status => ({ value: status.id, label: status.label }));

export function ordersTableHTML(rawRows, caption = 'Pedidos') {
  const rows = rawRows.map(orderListRow);
  return tableHTML({
    caption,
    columns: [
      { label: 'Pedido' }, { label: 'Cliente' }, { label: 'Itens', className: 'num' },
      { label: 'Total', className: 'num' }, { label: 'Estado' }, { label: 'Data' }
    ],
    rows: rows.map(row => [
      { html: `<a class="strong-link" href="#/pedidos/${encodeURIComponent(row.id)}">#${escapeHTML(row.number)}</a>` },
      { html: `<span class="cell-main">${escapeHTML(row.customerName)}</span><span class="cell-sub">${escapeHTML(row.phoneLabel)}</span>` },
      { html: escapeHTML(row.itemCount) },
      { html: escapeHTML(row.totalLabel) },
      { html: orderStatusChip(row.status) },
      { html: `<time datetime="${escapeHTML(row.createdAt ?? '')}">${escapeHTML(formatDate(row.createdAt))}</time>` }
    ])
  });
}

// ─── Lista ───────────────────────────────────────────────────────────────────

export function renderOrders(ctx) {
  ctx.setTitle('Pedidos');
  const initialStatus = isOrderStatus(ctx.route.query.estado) ? ctx.route.query.estado : '';
  ctx.main.innerHTML = `
    <div class="page-head"><h1 tabindex="-1">Pedidos</h1></div>
    <form class="toolbar" role="search" aria-label="Filtrar pedidos" data-filters>
      <div class="field field-grow">
        <label for="orders-q">Pesquisar</label>
        <input id="orders-q" name="q" type="search" placeholder="Número, nome ou telefone" autocomplete="off" maxlength="60">
      </div>
      <div class="field">
        <label for="orders-status">Estado</label>
        <select id="orders-status" name="status">${optionsHTML([{ value: '', label: 'Todos' }, ...STATUS_OPTIONS], initialStatus)}</select>
      </div>
    </form>
    <p class="result-count" aria-live="polite" data-count></p>
    <div data-region></div>
    <div class="load-more" data-more></div>`;

  const form = ctx.main.querySelector('[data-filters]');
  const region = ctx.main.querySelector('[data-region]');
  const more = ctx.main.querySelector('[data-more]');
  const count = ctx.main.querySelector('[data-count]');
  const state = { rows: [], total: 0, page: 0, request: 0, filters: { q: '', status: initialStatus } };

  const readFilters = () => ({ q: form.elements.q.value.trim(), status: form.elements.status.value });
  const hasFilters = () => Boolean(state.filters.q || state.filters.status);

  function paint() {
    if (!state.rows.length) {
      region.innerHTML = emptyHTML(hasFilters() ? 'Nenhum pedido corresponde à pesquisa.' : 'Sem pedidos ainda.');
      count.textContent = '';
    } else {
      region.innerHTML = ordersTableHTML(state.rows);
      count.textContent = `A mostrar ${state.rows.length} de ${pluralize(state.total, 'pedido', 'pedidos')}.`;
    }
    paintMore();
  }

  function paintMore(errorMessage = '') {
    if (errorMessage) {
      more.innerHTML = errorHTML(errorMessage);
      more.querySelector('[data-retry]').addEventListener('click', loadMore, { once: true });
      return;
    }
    more.innerHTML = state.rows.length < state.total
      ? '<button type="button" class="btn" data-load-more>Carregar mais</button>'
      : '';
  }

  function reload() {
    state.request += 1;
    const mine = state.request;
    state.filters = readFilters();
    state.page = 0;
    more.innerHTML = '';
    count.textContent = '';
    return loadInto(region, {
      load: () => ctx.api.listOrders({ ...state.filters, page: 0 }),
      isAlive: () => ctx.alive() && mine === state.request,
      loadingText: 'A carregar pedidos…',
      errorMessage: error => `Não foi possível carregar os pedidos. ${dbErrorMessage(error)}`,
      render: ({ rows, total }) => {
        state.rows = rows;
        state.total = total;
        paint();
      }
    });
  }

  async function loadMore() {
    const mine = state.request;
    const button = more.querySelector('button');
    if (button) {
      button.disabled = true;
      button.textContent = 'A carregar…';
    }
    try {
      const { rows, total } = await ctx.api.listOrders({ ...state.filters, page: state.page + 1 });
      if (!ctx.alive() || mine !== state.request) return;
      const known = new Set(state.rows.map(row => row.id));
      const firstNew = state.rows.length;
      state.rows = [...state.rows, ...rows.filter(row => !known.has(row.id))];
      state.total = total;
      state.page += 1;
      paint();
      // Mantém o foco no ponto onde a lista cresceu.
      region.querySelectorAll('tbody tr')[firstNew]?.querySelector('a')?.focus();
    } catch (error) {
      if (!ctx.alive() || mine !== state.request) return;
      console.error(error);
      paintMore(`Não foi possível carregar mais pedidos. ${dbErrorMessage(error)}`);
    }
  }

  const debouncedReload = debounce(reload, 350);
  form.addEventListener('submit', event => {
    event.preventDefault();
    debouncedReload.cancel();
    reload();
  });
  form.elements.q.addEventListener('input', debouncedReload);
  form.elements.status.addEventListener('change', () => {
    debouncedReload.cancel();
    reload();
  });
  more.addEventListener('click', event => {
    if (event.target.closest('[data-load-more]')) loadMore();
  });

  reload();
  return () => debouncedReload.cancel();
}

// ─── Detalhe ─────────────────────────────────────────────────────────────────

function itemsTableHTML(order) {
  return tableHTML({
    caption: 'Itens do pedido',
    columns: [
      { label: 'Produto' }, { label: 'Cor' }, { label: 'Tamanho' },
      { label: 'Quantidade × preço', className: 'num' }, { label: 'Subtotal', className: 'num' }
    ],
    rows: order.items.map(item => [
      { html: `<span class="cell-main">${escapeHTML(item.name)}</span>` },
      { html: escapeHTML(item.color) },
      { html: escapeHTML(item.size) },
      { html: `${escapeHTML(item.quantity)} × ${escapeHTML(formatPrice(item.unitPrice, '—'))}` },
      { html: escapeHTML(formatPrice(item.subtotal, '—')) }
    ])
  });
}

function detailHTML(order) {
  const statusOptions = [...STATUS_OPTIONS];
  if (!isOrderStatus(order.status)) statusOptions.push({ value: order.status, label: orderStatusLabel(order.status) });
  const totals = [
    ['Subtotal', formatPrice(order.subtotal, '—')],
    ...(order.deliveryFee !== null ? [['Entrega', formatPrice(order.deliveryFee, '—')]] : []),
    ['Total', formatPrice(order.total, '—')]
  ];
  const whatsapp = order.whatsappURL
    ? `<a class="btn btn-whatsapp" href="${escapeHTML(order.whatsappURL)}" target="_blank" rel="noopener noreferrer">Contactar no WhatsApp<span class="sr-only"> (abre noutro separador)</span></a>`
    : '<p class="hint">O telefone não tem um formato válido para abrir o WhatsApp.</p>';

  return `
    <div class="detail-grid">
      <section class="panel" aria-labelledby="order-customer">
        <h2 id="order-customer">Cliente</h2>
        <dl class="dl">
          <div><dt>Nome</dt><dd>${escapeHTML(order.customerName || '—')}</dd></div>
          <div><dt>Telefone</dt><dd>${escapeHTML(order.phoneLabel || '—')}</dd></div>
          <div><dt>Entrega</dt><dd>${escapeHTML(order.deliveryLabel)}</dd></div>
          <div><dt>Localização</dt><dd>${escapeHTML(order.location || '—')}</dd></div>
          <div><dt>Observações</dt><dd class="pre">${escapeHTML(order.notes || '—')}</dd></div>
          <div><dt>Criado em</dt><dd><time datetime="${escapeHTML(order.createdAt ?? '')}">${escapeHTML(formatDateTime(order.createdAt) || '—')}</time></dd></div>
        </dl>
        ${whatsapp}
      </section>
      <section class="panel" aria-labelledby="order-status-title">
        <h2 id="order-status-title">Estado</h2>
        <p>Estado atual: <span data-status-chip>${orderStatusChip(order.status)}</span></p>
        <form class="stack" data-status-form>
          <div class="field">
            <label for="order-status">Alterar estado</label>
            <select id="order-status" name="status">${optionsHTML(statusOptions, order.status)}</select>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Guardar estado</button>
          </div>
          <p class="form-status" role="status" data-status-msg></p>
          <p class="form-status form-status-error" role="alert" data-status-error></p>
        </form>
      </section>
    </div>
    <section class="panel" aria-labelledby="order-items">
      <h2 id="order-items">Itens (${escapeHTML(order.itemCount)})</h2>
      ${order.items.length ? itemsTableHTML(order) : emptyHTML('Este pedido não tem itens registados.')}
      <dl class="totals">
        ${totals.map(([label, value]) => `<div${label === 'Total' ? ' class="totals-grand"' : ''}><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}
      </dl>
      <p class="hint">Os itens mostram os dados guardados no momento do pedido (nome, cor, tamanho e preço), mesmo que o produto tenha sido alterado ou apagado depois.</p>
    </section>`;
}

export function renderOrderDetail(ctx) {
  ctx.setTitle('Pedido');
  ctx.main.innerHTML = `
    <div class="page-head">
      <div><a class="back-link" href="#/pedidos">← Pedidos</a><h1 tabindex="-1" data-title>Pedido</h1></div>
    </div>
    <div data-region></div>`;
  const region = ctx.main.querySelector('[data-region]');
  const title = ctx.main.querySelector('[data-title]');
  const notFound = () => { region.innerHTML = emptyHTML('Pedido não encontrado.', '<p><a class="btn" href="#/pedidos">Voltar aos pedidos</a></p>'); };

  if (!isUuid(ctx.route.id)) {
    notFound();
    return;
  }

  loadInto(region, {
    load: () => ctx.api.getOrder(ctx.route.id),
    isAlive: ctx.alive,
    loadingText: 'A carregar pedido…',
    errorMessage: error => `Não foi possível carregar o pedido. ${dbErrorMessage(error)}`,
    render: row => {
      if (!row) return notFound();
      const order = orderDetailFromDb(row);
      let savedStatus = order.status;
      title.textContent = `Pedido #${order.number}`;
      ctx.setTitle(`Pedido #${order.number}`);
      region.innerHTML = detailHTML(order);

      const form = region.querySelector('[data-status-form]');
      const select = form.elements.status;
      const button = form.querySelector('button[type="submit"]');
      const message = form.querySelector('[data-status-msg]');
      const alert = form.querySelector('[data-status-error]');
      ctx.setGuard(() => select.value !== savedStatus);

      form.addEventListener('submit', async event => {
        event.preventDefault();
        message.textContent = '';
        alert.textContent = '';
        if (select.value === savedStatus) {
          message.textContent = 'O estado não foi alterado.';
          return;
        }
        button.disabled = true;
        button.textContent = 'A guardar…';
        try {
          const updated = await ctx.api.updateOrderStatus(order.id, select.value);
          if (!ctx.alive()) return;
          savedStatus = updated.status;
          region.querySelector('[data-status-chip]').innerHTML = orderStatusChip(savedStatus);
          message.textContent = `Estado atualizado para “${orderStatusLabel(savedStatus)}”.`;
        } catch (error) {
          console.error(error);
          if (ctx.alive()) alert.textContent = `Não foi possível atualizar o estado. ${dbErrorMessage(error)}`;
        } finally {
          button.disabled = false;
          button.textContent = 'Guardar estado';
        }
      });
    }
  });
}
