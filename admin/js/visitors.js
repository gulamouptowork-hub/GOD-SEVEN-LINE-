// Visitantes: estatísticas anónimas da loja pública (supabase/analytics.sql), por hora (hoje), dia, semana ou mês.
// Um só pedido (analytics_report) alimenta cartões, gráficos, rankings e funil.
import { ANALYTICS_KEYS } from '/js/analytics.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  ANALYTICS_PERIODS, DEFAULT_PERIOD, ANALYTICS_TIMEZONE, axisLabels, bucketLabel, comparisonCaption, delta, deviceLabel,
  formatCount, formatPercent, funnelSteps, groupSources, hasAnyData, isMissingAnalytics, localToday, normalizeReport,
  pageLabel, peakHour, periodById, periodCaption, periodRange, ratio, sourceLabel
} from './analytics-logic.js';
import { barListHTML, donutHTML, funnelHTML, mountChart, sparklineSVG } from './charts.js';
import { dbErrorMessage } from './logic.js';
import { emptyHTML, errorHTML, loadingHTML, tableHTML } from './ui.js';

export const NO_TRACK_KEY = ANALYTICS_KEYS.optOut;
const AUTO_REFRESH_MS = 60000;
const pad = value => String(value).padStart(2, '0');

function readNoTrack() {
  try { return localStorage.getItem(NO_TRACK_KEY) === '1'; } catch { return false; }
}
function writeNoTrack(on) {
  try { localStorage.setItem(NO_TRACK_KEY, on ? '1' : '0'); } catch { /* sem armazenamento */ }
}

function deltaHTML(result) {
  const arrow = { up: '▲', down: '▼', flat: '●' }[result.direction];
  return `<span class="delta delta-${result.direction}" title="${escapeHTML(result.text)}"><span aria-hidden="true">${arrow}</span> ${escapeHTML(result.label)}<span class="sr-only"> — ${escapeHTML(result.text)}</span></span>`;
}

// Diferença de uma taxa em pontos percentuais (conversão).
function rateDeltaHTML(now, before, hasPrevious) {
  if (!hasPrevious) return deltaHTML({ direction: 'flat', label: '—', text: 'Sem visitantes no período anterior.' });
  const points = Math.round((now - before) * 1000) / 10;
  const direction = points > 0 ? 'up' : points < 0 ? 'down' : 'flat';
  const label = `${points > 0 ? '+' : points < 0 ? '−' : ''}${String(Math.abs(points)).replace('.', ',')} p.p.`;
  return deltaHTML({ direction, label, text: `${label} face ao período anterior (${formatPercent(before)}).` });
}

function kpiHTML({ label, value, deltaMarkup, spark = [], tone = 1, hint = '' }) {
  return `<li class="kpi">
    <p class="kpi-label">${escapeHTML(label)}</p>
    <p class="kpi-value">${escapeHTML(value)}</p>
    <div class="kpi-foot">${deltaMarkup}${hint ? `<span class="kpi-hint">${escapeHTML(hint)}</span>` : ''}</div>
    ${sparklineSVG(spark, { tone })}
  </li>`;
}

const legendHTML = series => `<ul class="chart-legend">${series.map(item => `<li><span class="chart-swatch tone-${item.tone}" aria-hidden="true"></span>${escapeHTML(item.name)}</li>`).join('')}</ul>`;

function dataTableHTML(caption, headers, rows) {
  return `<details class="chart-data"><summary>Ver dados em tabela</summary>${tableHTML({
    caption,
    cards: false,
    columns: headers.map((label, index) => ({ label, className: index ? 'num' : '' })),
    rows: rows.map(cells => cells.map(html => ({ html: escapeHTML(html) })))
  })}</details>`;
}

function setupHTML() {
  return `<section class="panel analytics-setup" aria-labelledby="setup-title">
    <h2 id="setup-title">Ativar as estatísticas de visitantes</h2>
    <p>A base de dados ainda não tem a parte das estatísticas. Basta fazê-lo uma vez:</p>
    <ol class="setup-list">
      <li>No Supabase, abre <strong>SQL Editor → New query</strong>.</li>
      <li>Cola todo o conteúdo do ficheiro <code>supabase/analytics.sql</code> do projeto e carrega em <strong>Run</strong>.</li>
      <li>Volta aqui e carrega em <strong>Atualizar</strong>. As visitas começam a contar a partir desse momento.</li>
    </ol>
    <p class="muted">Não é preciso alterar nada na Vercel: a loja já envia os eventos e ignora o envio enquanto isto não estiver ativo.</p>
  </section>`;
}

function noDataHTML() {
  return `<section class="panel analytics-empty">
    <h2>Ainda sem visitas registadas</h2>
    <p>A recolha está ativa, mas ainda ninguém visitou a loja desde que foi ligada. Os números aparecem aqui assim que houver visitas.</p>
    <p class="muted">Para testar, abre a loja noutro browser ou numa janela privada: as visitas deste browser não contam enquanto a opção “Não contar as visitas deste browser” estiver ligada.</p>
  </section>`;
}

function reportHTML(report, range) {
  const { totals, previous, series } = report;
  const kind = range.bucket;
  const unit = range.period.unit;
  const buckets = series.map(point => point.bucket);
  const conversion = ratio(totals.funnel.sentOrder, totals.funnel.visitors);
  const previousConversion = ratio(previous.funnel.sentOrder, previous.funnel.visitors);
  const perVisitor = totals.visitors ? (totals.pageViews / totals.visitors).toFixed(1).replace('.', ',') : '0';

  const kpis = [
    kpiHTML({ label: 'Visitantes', value: formatCount(totals.visitors), deltaMarkup: deltaHTML(delta(totals.visitors, previous.visitors)), spark: series.map(p => p.visitors), tone: 1, hint: `${formatCount(totals.sessions)} visitas` }),
    kpiHTML({ label: 'Páginas vistas', value: formatCount(totals.pageViews), deltaMarkup: deltaHTML(delta(totals.pageViews, previous.pageViews)), spark: series.map(p => p.pageViews), tone: 2, hint: `${perVisitor} por visitante` }),
    kpiHTML({ label: 'Produtos vistos', value: formatCount(totals.productViews), deltaMarkup: deltaHTML(delta(totals.productViews, previous.productViews)), spark: series.map(p => p.productViews), tone: 3 }),
    kpiHTML({ label: 'Adições ao pedido', value: formatCount(totals.addToCart), deltaMarkup: deltaHTML(delta(totals.addToCart, previous.addToCart)), spark: series.map(p => p.addToCart), tone: 4 }),
    kpiHTML({ label: 'Pedidos recebidos', value: formatCount(totals.ordersRegistered), deltaMarkup: deltaHTML(delta(totals.ordersRegistered, previous.ordersRegistered)), tone: 5, hint: 'criados no site, sem cancelados' }),
    kpiHTML({ label: 'Conversão', value: formatPercent(conversion), deltaMarkup: rateDeltaHTML(conversion, previousConversion, previous.funnel.visitors > 0), tone: 1, hint: 'visitantes que enviaram pedido' })
  ].join('');

  const trafficSeries = [{ name: 'Visitantes', tone: 1 }, { name: 'Páginas vistas', tone: 2 }];
  const topVisitors = Math.max(0, ...series.map(p => p.visitors));
  const topIndex = series.findIndex(p => p.visitors === topVisitors);

  const names = new Map(report.topProducts.filter(item => item.name).map(item => [item.slug, item.name]));
  const products = report.topProducts.map(item => ({
    label: item.name || `${item.slug} (já não existe)`,
    href: item.productId ? `#/produtos/${encodeURIComponent(item.productId)}` : '',
    value: item.views,
    tone: 3,
    sub: [
      `${formatCount(item.visitors)} ${item.visitors === 1 ? 'visitante' : 'visitantes'}`,
      `${formatCount(item.adds)} ${item.adds === 1 ? 'adição' : 'adições'} ao pedido`,
      item.views ? `${formatPercent(ratio(item.adds, item.views))} adicionam` : '',
      item.whatsapp ? `${formatCount(item.whatsapp)} no WhatsApp` : ''
    ].filter(Boolean).join(' · ')
  }));

  const sources = groupSources(report.sources).map(group => ({
    label: group.label,
    value: group.sessions,
    tone: 1,
    sub: group.label === sourceLabel('') ? 'Link direto, app ou origem escondida pelo browser' : group.sources.filter(source => source !== group.label.toLowerCase()).join(', ')
  }));

  const deviceTones = { mobile: 1, desktop: 2, tablet: 3 };
  const devices = report.devices.map(item => ({ label: deviceLabel(item.device), value: item.visitors, tone: deviceTones[item.device] ?? 6 }));
  const peak = peakHour(report.hours);
  const pages = report.topPages.map(item => ({ label: pageLabel(item.path, names), value: item.views, tone: 2, sub: `${item.path} · ${formatCount(item.visitors)} ${item.visitors === 1 ? 'visitante' : 'visitantes'}` }));
  const steps = funnelSteps(totals.funnel);

  return `
    <section aria-labelledby="kpi-title">
      <h2 id="kpi-title" class="sr-only">Resumo do período</h2>
      <ul class="kpis">${kpis}</ul>
    </section>

    <section class="panel" aria-labelledby="traffic-title">
      <div class="panel-head">
        <h2 id="traffic-title">Visitantes e páginas vistas por ${escapeHTML(unit)}</h2>
        ${legendHTML(trafficSeries)}
      </div>
      <div class="chart" data-chart="traffic"></div>
      ${topVisitors ? `<p class="chart-note">Melhor ${escapeHTML(unit)}: <strong>${escapeHTML(bucketLabel(buckets[topIndex], kind, { long: true }))}</strong> com ${escapeHTML(formatCount(topVisitors))} ${topVisitors === 1 ? 'visitante' : 'visitantes'}.</p>` : ''}
      ${dataTableHTML(`Visitantes e páginas vistas por ${unit}`, [unit[0].toUpperCase() + unit.slice(1), 'Visitantes', 'Páginas vistas', 'Produtos vistos', 'Adições ao pedido'],
        series.map(p => [bucketLabel(p.bucket, kind, { long: true }), formatCount(p.visitors), formatCount(p.pageViews), formatCount(p.productViews), formatCount(p.addToCart)]))}
    </section>

    <div class="analytics-grid">
      <section class="panel" aria-labelledby="products-title">
        <div class="panel-head"><h2 id="products-title">Produtos mais vistos</h2><span class="muted">visualizações</span></div>
        ${products.length ? barListHTML(products, { valueLabel: 'visualizações', label: 'Produtos mais vistos' }) : emptyHTML('Ainda sem produtos vistos neste período.')}
      </section>
      <section class="panel" aria-labelledby="funnel-title">
        <div class="panel-head"><h2 id="funnel-title">Funil de compra</h2><span class="muted">visitantes distintos</span></div>
        ${totals.funnel.visitors ? funnelHTML(steps, { formatPercent }) : emptyHTML('Sem visitantes neste período.')}
      </section>
      <section class="panel" aria-labelledby="sources-title">
        <div class="panel-head"><h2 id="sources-title">De onde vêm as visitas</h2><span class="muted">visitas</span></div>
        ${sources.length ? barListHTML(sources, { valueLabel: 'visitas', label: 'Origem das visitas' }) : emptyHTML('Sem visitas neste período.')}
      </section>
      <section class="panel" aria-labelledby="devices-title">
        <div class="panel-head"><h2 id="devices-title">Dispositivos</h2><span class="muted">visitantes</span></div>
        ${devices.length ? donutHTML({ segments: devices, centerLabel: 'visitantes', label: 'Visitantes por dispositivo' }) : emptyHTML('Sem visitantes neste período.')}
      </section>
      <section class="panel" aria-labelledby="hours-title">
        <div class="panel-head"><h2 id="hours-title">Horas de maior movimento</h2><span class="muted">páginas vistas · hora de Maputo</span></div>
        <div class="chart chart-compact" data-chart="hours"></div>
        <p class="chart-note">${peak ? `Pico: <strong>${escapeHTML(peak.label)}</strong> (${escapeHTML(formatCount(peak.value))} páginas vistas).` : 'Sem páginas vistas neste período.'}</p>
        ${dataTableHTML('Páginas vistas por hora do dia', ['Hora', 'Páginas vistas'], report.hours.map((value, hour) => [`${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00`, formatCount(value)]))}
      </section>
      <section class="panel" aria-labelledby="pages-title">
        <div class="panel-head"><h2 id="pages-title">Páginas mais visitadas</h2><span class="muted">páginas vistas</span></div>
        ${pages.length ? barListHTML(pages, { valueLabel: 'páginas vistas', label: 'Páginas mais visitadas' }) : emptyHTML('Sem páginas vistas neste período.')}
      </section>
    </div>`;
}

export function renderVisitors(ctx) {
  ctx.setTitle('Visitantes');
  let periodId = periodById(ctx.route.query.periodo).id;
  let token = 0;
  let charts = [];
  let timer = null;
  let lastRange = null;

  ctx.main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 tabindex="-1">Visitantes</h1>
        <p class="page-sub">Estatísticas anónimas da loja pública · hora de Maputo</p>
      </div>
      <p class="live-pill" data-live hidden><span class="live-dot" aria-hidden="true"></span><span data-live-text></span></p>
    </div>
    <div class="analytics-toolbar">
      <div class="segmented" role="group" aria-label="Período">
        ${ANALYTICS_PERIODS.map(period => `<button type="button" class="segmented-btn" data-period="${period.id}" aria-pressed="${period.id === periodId}">
          <span class="segmented-label">${escapeHTML(period.label)}</span>${period.hint ? `<span class="segmented-hint">${escapeHTML(period.hint)}</span>` : '<span class="segmented-hint">Por hora</span>'}
        </button>`).join('')}
      </div>
      <div class="analytics-refresh">
        <span class="muted" data-updated aria-live="polite"></span>
        <button type="button" class="btn btn-small" data-refresh>Atualizar</button>
      </div>
    </div>
    <p class="period-caption" data-caption></p>
    <div data-region></div>
    <section class="panel analytics-privacy" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Privacidade</h2>
      <p>Cada visita guarda só um identificador aleatório do browser, a página, o produto, o site de origem e o tipo de dispositivo. Não se guardam nomes, telefones, endereços IP nem cookies de terceiros. Quem tem “Não rastrear” (Do Not Track) ativo não é contado.</p>
      <label class="field-check"><input type="checkbox" data-no-track${readNoTrack() ? ' checked' : ''}><span>Não contar as visitas deste browser (recomendado para quem gere a loja)</span></label>
    </section>`;

  const region = ctx.main.querySelector('[data-region]');
  const caption = ctx.main.querySelector('[data-caption]');
  const updated = ctx.main.querySelector('[data-updated]');
  const live = ctx.main.querySelector('[data-live]');
  const liveText = ctx.main.querySelector('[data-live-text]');
  const refreshButton = ctx.main.querySelector('[data-refresh]');

  function destroyCharts() {
    charts.forEach(stop => stop());
    charts = [];
  }

  function paint(report, range) {
    destroyCharts();
    const when = report.generatedAt ?? new Date();
    updated.textContent = `Atualizado às ${pad(when.getHours())}:${pad(when.getMinutes())}`;
    live.hidden = false;
    liveText.textContent = report.liveVisitors === 1 ? '1 pessoa na loja agora' : `${formatCount(report.liveVisitors)} pessoas na loja agora`;
    live.title = 'Visitantes com atividade nos últimos 5 minutos';
    if (!hasAnyData(report)) {
      region.innerHTML = noDataHTML();
      return;
    }
    const since = report.firstEventAt;
    caption.textContent = `${periodCaption(range)} · ${comparisonCaption(range)} Dados desde ${pad(since.getDate())}/${pad(since.getMonth() + 1)}/${since.getFullYear()}.`;
    region.innerHTML = reportHTML(report, range);
    const buckets = report.series.map(point => point.bucket);
    const traffic = region.querySelector('[data-chart="traffic"]');
    charts.push(mountChart(traffic, {
      id: 'traffic',
      type: 'line',
      title: `Visitantes e páginas vistas por ${range.period.unit}`,
      summary: `Visitantes por ${range.period.unit}: ${formatCount(report.totals.visitors)} no total.`,
      labels: axisLabels(buckets, range.bucket),
      longLabels: buckets.map(bucket => bucketLabel(bucket, range.bucket, { long: true })),
      series: [
        { name: 'Visitantes', values: report.series.map(point => point.visitors), tone: 1 },
        { name: 'Páginas vistas', values: report.series.map(point => point.pageViews), tone: 2 }
      ],
      extra: index => [
        { label: 'Produtos vistos', value: formatCount(report.series[index].productViews) },
        { label: 'Adições ao pedido', value: formatCount(report.series[index].addToCart) }
      ]
    }));
    const hours = region.querySelector('[data-chart="hours"]');
    charts.push(mountChart(hours, {
      id: 'hours',
      type: 'columns',
      height: 200,
      title: 'Horas de maior movimento',
      summary: 'Páginas vistas por hora do dia.',
      labels: report.hours.map((_, hour) => `${hour}h`),
      longLabels: report.hours.map((_, hour) => `${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00`),
      series: [{ name: 'Páginas vistas', values: report.hours, tone: 4 }]
    }));
  }

  async function load({ silent = false } = {}) {
    const mine = ++token;
    const range = periodRange(periodId, localToday(new Date(), ANALYTICS_TIMEZONE));
    lastRange = range;
    caption.textContent = periodCaption(range);
    if (!silent) {
      destroyCharts();
      region.innerHTML = loadingHTML('A carregar estatísticas…');
      region.setAttribute('aria-busy', 'true');
    }
    refreshButton.disabled = true;
    try {
      const raw = await ctx.api.analyticsReport({ from: range.from, to: range.to, bucket: range.bucket, timeZone: ANALYTICS_TIMEZONE });
      if (!ctx.alive() || mine !== token) return;
      paint(normalizeReport(raw), range);
    } catch (error) {
      if (!ctx.alive() || mine !== token) return;
      console.error(error);
      if (silent) return;
      destroyCharts();
      live.hidden = true;
      if (isMissingAnalytics(error)) {
        region.innerHTML = setupHTML();
      } else {
        region.innerHTML = errorHTML(`Não foi possível carregar as estatísticas. ${dbErrorMessage(error)}`);
        region.querySelector('[data-retry]').addEventListener('click', () => load(), { once: true });
      }
    } finally {
      if (ctx.alive() && mine === token) {
        region.removeAttribute('aria-busy');
        refreshButton.disabled = false;
      }
    }
  }

  ctx.main.querySelector('.segmented').addEventListener('click', event => {
    const button = event.target.closest('[data-period]');
    if (!button || button.dataset.period === periodId) return;
    periodId = button.dataset.period;
    ctx.main.querySelectorAll('[data-period]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.period === periodId)));
    ctx.replaceRoute(periodId === DEFAULT_PERIOD ? '#/visitantes' : `#/visitantes?periodo=${periodId}`);
    load();
  });
  refreshButton.addEventListener('click', () => load());
  ctx.main.querySelector('[data-no-track]').addEventListener('change', event => {
    writeNoTrack(event.target.checked);
    ctx.flash(event.target.checked ? 'As visitas deste browser deixam de contar nas estatísticas.' : 'As visitas deste browser passam a contar nas estatísticas.', 'info');
  });

  // "Hoje" atualiza-se sozinho a cada minuto (sem piscar e sem roubar o foco).
  timer = setInterval(() => {
    if (periodId !== 'hoje' || document.visibilityState !== 'visible' || !lastRange) return;
    if (region.contains(document.activeElement)) return;
    load({ silent: true });
  }, AUTO_REFRESH_MS);

  load();

  return () => {
    token += 1;
    clearInterval(timer);
    destroyCharts();
  };
}
