// Dashboard: contagens principais e últimos pedidos.
import { SITE_CONFIG } from '/config/site.js';
import { escapeHTML } from '/js/lib/html.js';
import { dbErrorMessage } from './logic.js';
import { ordersTableHTML } from './orders.js';
import { emptyHTML, loadInto } from './ui.js';

function statHTML({ label, value, href, tone = '', hint = '' }) {
  return `<li><a class="stat${tone ? ` stat-${tone}` : ''}" href="${href}">
    <span class="stat-value">${escapeHTML(value)}</span>
    <span class="stat-label">${escapeHTML(label)}</span>
    ${hint ? `<span class="stat-hint">${escapeHTML(hint)}</span>` : ''}
  </a></li>`;
}

export function renderDashboard(ctx) {
  ctx.setTitle('Dashboard');
  ctx.main.innerHTML = `
    <div class="page-head"><h1 tabindex="-1">Dashboard</h1></div>
    <div data-region></div>`;
  const region = ctx.main.querySelector('[data-region]');
  const threshold = SITE_CONFIG.lowStockThreshold;

  loadInto(region, {
    load: () => ctx.api.dashboard(),
    isAlive: ctx.alive,
    errorMessage: error => `Não foi possível carregar o dashboard. ${dbErrorMessage(error)}`,
    render: data => {
      const stats = [
        { label: 'Produtos ativos', value: data.activeProducts, href: '#/produtos?estado=active' },
        { label: 'Pedidos novos', value: data.newOrders, href: '#/pedidos?estado=novo', tone: data.newOrders ? 'info' : '' },
        { label: 'Variantes com stock baixo', value: data.stock.low, href: '#/stock?filtro=low', tone: data.stock.low ? 'warn' : '', hint: `1 a ${threshold} unidades` },
        { label: 'Variantes esgotadas', value: data.stock.out, href: '#/stock?filtro=out', tone: data.stock.out ? 'danger' : '', hint: '0 unidades' },
        { label: 'Variantes sem stock definido', value: data.stock.unknown, href: '#/stock?filtro=unknown', hint: 'Não podem ser encomendadas' }
      ];
      region.innerHTML = `
        <section aria-labelledby="dash-stats">
          <h2 id="dash-stats" class="sr-only">Resumo</h2>
          <ul class="stats">${stats.map(statHTML).join('')}</ul>
          <p class="hint">As contagens de variantes excluem produtos arquivados.</p>
        </section>
        <section class="panel" aria-labelledby="dash-orders">
          <div class="panel-head">
            <h2 id="dash-orders">Últimos pedidos</h2>
            <a class="text-link" href="#/pedidos">Ver todos</a>
          </div>
          ${data.recentOrders.length ? ordersTableHTML(data.recentOrders, 'Últimos 5 pedidos') : emptyHTML('Sem pedidos ainda.')}
        </section>`;
    }
  });
}
