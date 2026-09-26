// Dashboard: contagens principais, gráficos (pedidos por dia e por estado, visitantes, stock) e últimos pedidos.
import { SITE_CONFIG } from '/config/site.js';
import { formatPrice } from '/js/lib/format.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  ANALYTICS_TIMEZONE, addDays, axisLabels, bucketLabel, formatCount, formatPercent, hasAnyData, isMissingAnalytics,
  localDate, localToday, normalizeReport, ordersByDay, ratio
} from './analytics-logic.js';
import { donutHTML, mountChart } from './charts.js';
import { dbErrorMessage } from './logic.js';
import { ordersTableHTML } from './orders.js';
import { emptyHTML, loadInto, loadingHTML, tableHTML } from './ui.js';

const ORDER_DAYS = 30;
const STATUS_TONES = { novo: 1, confirmado: 4, em_preparacao: 3, concluido: 2, cancelado: 6 };

function statHTML({ label, value, href, tone = '', hint = '' }) {
  return `<li><a class="stat${tone ? ` stat-${tone}` : ''}" href="${href}">
    <span class="stat-value">${escapeHTML(value)}</span>
    <span class="stat-label">${escapeHTML(label)}</span>
    ${hint ? `<span class="stat-hint">${escapeHTML(hint)}</span>` : ''}
  </a></li>`;
}

const money = value => formatPrice(value, '0 MT');

function ordersPanelHTML(points) {
  const orders = points.reduce((sum, point) => sum + point.orders, 0);
  const value = points.reduce((sum, point) => sum + point.value, 0);
  const cancelled = points.reduce((sum, point) => sum + point.cancelled, 0);
  const table = tableHTML({
    caption: 'Pedidos por dia',
    cards: false,
    columns: [{ label: 'Dia' }, { label: 'Pedidos', className: 'num' }, { label: 'Valor pedido', className: 'num' }, { label: 'Cancelados', className: 'num' }],
    rows: points.map(point => [
      { html: escapeHTML(bucketLabel(point.date, 'day', { long: true })) },
      { html: escapeHTML(formatCount(point.orders)) },
      { html: escapeHTML(money(point.value)) },
      { html: escapeHTML(formatCount(point.cancelled)) }
    ])
  });
  return `<section class="panel" aria-labelledby="dash-orders-chart">
    <div class="panel-head"><h2 id="dash-orders-chart">Pedidos nos últimos ${ORDER_DAYS} dias</h2><a class="text-link panel-link" href="#/pedidos">Ver pedidos</a></div>
    ${orders || cancelled ? `<div class="chart" data-chart="orders"></div>
      <p class="chart-note"><strong>${escapeHTML(formatCount(orders))}</strong> ${orders === 1 ? 'pedido' : 'pedidos'} · valor pedido <strong>${escapeHTML(money(value))}</strong>${orders ? ` · média ${escapeHTML(money(Math.round(value / orders)))} por pedido` : ''}${cancelled ? ` · ${escapeHTML(formatCount(cancelled))} ${cancelled === 1 ? 'cancelado' : 'cancelados'} (fora das contas)` : ''}.</p>
      <details class="chart-data"><summary>Ver dados em tabela</summary>${table}</details>`
    : emptyHTML(`Sem pedidos nos últimos ${ORDER_DAYS} dias.`)}
  </section>`;
}

function statusPanelHTML(orders) {
  const segments = SITE_CONFIG.orderStatuses.map(status => ({
    label: status.label,
    value: orders.filter(order => order.status === status.id).length,
    tone: STATUS_TONES[status.id] ?? 6
  }));
  return `<section class="panel" aria-labelledby="dash-status">
    <div class="panel-head"><h2 id="dash-status">Pedidos por estado</h2><span class="muted">últimos ${ORDER_DAYS} dias</span></div>
    ${orders.length ? donutHTML({ segments, centerLabel: orders.length === 1 ? 'pedido' : 'pedidos', label: 'Pedidos por estado' }) : emptyHTML('Sem pedidos neste período.')}
  </section>`;
}

function stockPanelHTML(stock, threshold) {
  const segments = [
    { label: `Com stock (mais de ${threshold})`, value: stock.in ?? 0, tone: 2 },
    { label: `Stock baixo (1 a ${threshold})`, value: stock.low, tone: 3 },
    { label: 'Esgotadas', value: stock.out, tone: 5 },
    { label: 'Sem stock definido', value: stock.unknown, tone: 6 }
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return `<section class="panel" aria-labelledby="dash-stock">
    <div class="panel-head"><h2 id="dash-stock">Stock das variantes</h2><a class="text-link panel-link" href="#/stock">Gerir stock</a></div>
    ${total ? donutHTML({ segments, centerLabel: 'variantes', label: 'Stock das variantes' }) : emptyHTML('Ainda sem variantes.')}
  </section>`;
}

const visitorsShellHTML = `<section class="panel" aria-labelledby="dash-visitors">
  <div class="panel-head"><h2 id="dash-visitors">Visitantes nos últimos 7 dias</h2><a class="text-link panel-link" href="#/visitantes">Ver estatísticas</a></div>
  <div data-visitors>${loadingHTML('A carregar visitantes…')}</div>
</section>`;

async function paintVisitors(ctx, container, charts) {
  const today = localToday(new Date(), ANALYTICS_TIMEZONE);
  let report;
  try {
    report = normalizeReport(await ctx.api.analyticsReport({ from: addDays(today, -6), to: today, bucket: 'day', timeZone: ANALYTICS_TIMEZONE }));
  } catch (error) {
    if (!ctx.alive()) return;
    console.warn('Estatísticas indisponíveis', error);
    container.innerHTML = isMissingAnalytics(error)
      ? `<div class="state state-empty"><p>As estatísticas de visitantes ainda não estão ativadas.</p><p><a class="btn btn-small" href="#/visitantes">Como ativar</a></p></div>`
      : emptyHTML(`Não foi possível carregar os visitantes. ${dbErrorMessage(error)}`);
    return;
  }
  if (!ctx.alive()) return;
  if (!hasAnyData(report)) {
    container.innerHTML = emptyHTML('Ainda sem visitas registadas.');
    return;
  }
  const { totals } = report;
  const buckets = report.series.map(point => point.bucket);
  container.innerHTML = `<ul class="mini-stats">
      <li><span class="mini-stat-value">${escapeHTML(formatCount(totals.visitors))}</span><span class="mini-stat-label">visitantes</span></li>
      <li><span class="mini-stat-value">${escapeHTML(formatCount(totals.productViews))}</span><span class="mini-stat-label">produtos vistos</span></li>
      <li><span class="mini-stat-value">${escapeHTML(formatPercent(ratio(totals.funnel.sentOrder, totals.funnel.visitors)))}</span><span class="mini-stat-label">conversão</span></li>
    </ul>
    <div class="chart chart-compact" data-chart="visitors"></div>`;
  charts.push(mountChart(container.querySelector('[data-chart="visitors"]'), {
    id: 'dash-visitors',
    type: 'line',
    height: 190,
    summary: `Visitantes por dia nos últimos 7 dias: ${formatCount(totals.visitors)} no total.`,
    labels: axisLabels(buckets, 'day'),
    longLabels: buckets.map(bucket => bucketLabel(bucket, 'day', { long: true })),
    series: [{ name: 'Visitantes', values: report.series.map(point => point.visitors), tone: 1 }],
    extra: index => [{ label: 'Páginas vistas', value: formatCount(report.series[index].pageViews) }]
  }));
}

export function renderDashboard(ctx) {
  ctx.setTitle('Dashboard');
  ctx.main.innerHTML = `
    <div class="page-head"><h1 tabindex="-1">Dashboard</h1></div>
    <div data-region></div>`;
  const region = ctx.main.querySelector('[data-region]');
  const threshold = SITE_CONFIG.lowStockThreshold;
  const charts = [];

  loadInto(region, {
    load: () => {
      const today = localToday(new Date(), ANALYTICS_TIMEZONE);
      const from = addDays(today, -(ORDER_DAYS - 1));
      // Meia-noite de Maputo (UTC+2) do primeiro dia, com margem de 1 dia para qualquer fuso; o agrupamento filtra.
      const since = new Date(Date.parse(`${addDays(from, -1)}T00:00:00Z`)).toISOString();
      return Promise.all([ctx.api.dashboard(), ctx.api.recentOrderStats(since)]).then(([data, orders]) => ({ data, orders, from, to: today }));
    },
    isAlive: ctx.alive,
    errorMessage: error => `Não foi possível carregar o dashboard. ${dbErrorMessage(error)}`,
    render: ({ data, orders, from, to }) => {
      const points = ordersByDay(orders, from, to);
      const inPeriod = orders.filter(order => { const day = localDate(order.created_at); return day >= from && day <= to; });
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
        <div class="analytics-grid analytics-grid-3">
          ${ordersPanelHTML(points)}
          ${statusPanelHTML(inPeriod)}
        </div>
        <div class="analytics-grid analytics-grid-3">
          ${visitorsShellHTML}
          ${stockPanelHTML(data.stock, threshold)}
        </div>
        <section class="panel" aria-labelledby="dash-orders">
          <div class="panel-head">
            <h2 id="dash-orders">Últimos pedidos</h2>
            <a class="text-link" href="#/pedidos">Ver todos</a>
          </div>
          ${data.recentOrders.length ? ordersTableHTML(data.recentOrders, 'Últimos 5 pedidos') : emptyHTML('Sem pedidos ainda.')}
        </section>`;

      const ordersChart = region.querySelector('[data-chart="orders"]');
      if (ordersChart) {
        charts.push(mountChart(ordersChart, {
          id: 'dash-orders',
          type: 'columns',
          height: 220,
          summary: `Pedidos por dia nos últimos ${ORDER_DAYS} dias.`,
          labels: axisLabels(points.map(point => point.date), 'day'),
          longLabels: points.map(point => bucketLabel(point.date, 'day', { long: true })),
          series: [{ name: 'Pedidos', values: points.map(point => point.orders), tone: 1 }],
          extra: index => [
            { label: 'Valor pedido', value: money(points[index].value) },
            ...(points[index].cancelled ? [{ label: 'Cancelados', value: formatCount(points[index].cancelled) }] : [])
          ]
        }));
      }
      paintVisitors(ctx, region.querySelector('[data-visitors]'), charts);
    }
  });

  return () => charts.forEach(stop => stop());
}
