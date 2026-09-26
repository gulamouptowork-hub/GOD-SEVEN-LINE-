import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BATCH, SERVER_EVENTS, analyticsDevice, analyticsPath, analyticsReferrer, nextSession, normalizeSourceHost,
  productSlugFromPath, randomId, serverEvent, trackingAllowed
} from '../js/lib/analytics.js';
import {
  addDays, addMonths, axisLabels, bucketLabel, delta, elapsedSeries, formatPercent, funnelSteps, groupSources, isMissingAnalytics,
  localClock, localDate, localHour, localToday, normalizeReport, ordersByDay, pageLabel, peakHour, periodCaption, periodRange,
  sourceLabel, startOfWeek
} from '../admin/js/analytics-logic.js';
import { barListHTML, columnChartSVG, donutHTML, labelIndices, lineChartSVG, niceScale, sparklineSVG, tooltipHTML } from '../admin/js/charts.js';

// ─── Loja: recolha ───────────────────────────────────────────────────────────

test('analyticsPath limpa query, barra final e .html', () => {
  assert.equal(analyticsPath('/produtos/?cat=polos'), '/produtos');
  assert.equal(analyticsPath('/servicos.html'), '/servicos');
  assert.equal(analyticsPath('/index.html'), '/');
  assert.equal(analyticsPath(''), '/');
  assert.equal(analyticsPath('/Localizacao#mapa'), '/Localizacao');
  assert.equal(analyticsPath(`/${'x'.repeat(300)}`).length, 200);
});

test('productSlugFromPath só aceita /produtos/<slug válido>', () => {
  assert.equal(productSlugFromPath('/produtos/polo-seven'), 'polo-seven');
  assert.equal(productSlugFromPath('/produtos/polo-seven/'), 'polo-seven');
  assert.equal(productSlugFromPath('/produtos'), null);
  assert.equal(productSlugFromPath('/produtos/Polo%20Seven'), null);
  assert.equal(productSlugFromPath('/produtos/%E0%A4%A'), null);
});

test('analyticsReferrer: utm_source, domínio externo normalizado, interno → null', () => {
  assert.equal(analyticsReferrer({ referrer: 'https://l.instagram.com/?u=x', host: 'god-seven-line.vercel.app' }), 'instagram.com');
  assert.equal(analyticsReferrer({ referrer: 'https://www.google.co.mz/', host: 'loja.co.mz' }), 'google.co.mz');
  assert.equal(analyticsReferrer({ referrer: 'https://god-seven-line.vercel.app/produtos', host: 'god-seven-line.vercel.app' }), null);
  assert.equal(analyticsReferrer({ referrer: '', host: 'x', search: '?utm_source=Instagram Bio' }), 'instagram-bio');
  assert.equal(analyticsReferrer({ referrer: 'https://facebook.com', host: 'x', search: '?utm_source=<script>' }), 'facebook.com');
  assert.equal(analyticsReferrer({ referrer: 'não é url', host: 'x' }), null);
  assert.equal(normalizeSourceHost('LM.Facebook.com.'), 'facebook.com');
});

test('analyticsDevice pelo tamanho do ecrã', () => {
  assert.equal(analyticsDevice({ width: 390, height: 844, coarse: true }), 'mobile');
  assert.equal(analyticsDevice({ width: 1024, height: 768, coarse: true }), 'tablet');
  assert.equal(analyticsDevice({ width: 1920, height: 1080, coarse: false }), 'desktop');
  assert.equal(analyticsDevice({ width: 500, height: 900, coarse: false }), 'mobile');
  assert.equal(analyticsDevice({}), 'desktop');
});

test('randomId gera UUID v4 também sem crypto.randomUUID', () => {
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(randomId(), v4);
  assert.match(randomId({ getRandomValues: bytes => bytes.fill(255) }), v4);
});

test('nextSession renova até 30 minutos de inatividade', () => {
  const ids = ['nova'];
  const make = () => ids.shift();
  assert.deepEqual(nextSession({ id: 'a', last: 1000 }, 1000 + 29 * 60000, make), { id: 'a', last: 1000 + 29 * 60000, isNew: false });
  assert.equal(nextSession({ id: 'a', last: 1000 }, 1000 + 31 * 60000, make).id, 'nova');
  assert.equal(nextSession(null, 5, () => 'x').isNew, true);
  assert.equal(nextSession({ id: 'a', last: 9000 }, 5, () => 'relogio').id, 'relogio', 'relógio andou para trás → nova sessão');
});

test('serverEvent: só eventos da lista, com slug e origem validados', () => {
  assert.equal(serverEvent('select_size', {}, { pathname: '/produtos/polo-seven' }), null);
  assert.deepEqual(serverEvent('view_product', { slug: 'polo-seven' }, { pathname: '/produtos/polo-seven' }), { event: 'view_product', path: '/produtos/polo-seven', product_slug: 'polo-seven' });
  assert.deepEqual(serverEvent('add_to_cart', { productId: 'x', value: 1250 }, { pathname: '/produtos/polo-seven' }), { event: 'add_to_cart', path: '/produtos/polo-seven', product_slug: 'polo-seven' });
  assert.deepEqual(serverEvent('page_view', { referrer: 'instagram.com' }, { pathname: '/' }), { event: 'page_view', path: '/', referrer: 'instagram.com' });
  assert.deepEqual(serverEvent('begin_checkout', { value: 5000, items: 2 }, { pathname: '/finalizar' }), { event: 'begin_checkout', path: '/finalizar' });
  const record = serverEvent('whatsapp_checkout', { orderNumber: 'GSL-0001', value: 4000 }, { pathname: '/finalizar' });
  assert.deepEqual(Object.keys(record).sort(), ['event', 'path'], 'nada do cliente/pedido vai para as estatísticas');
  assert.ok(SERVER_EVENTS.length === 6 && MAX_BATCH === 25);
});

test('trackingAllowed respeita DNT, GPC, automação e o browser do admin', () => {
  assert.equal(trackingAllowed({}), true);
  assert.equal(trackingAllowed({ doNotTrack: '1' }), false);
  assert.equal(trackingAllowed({ globalPrivacyControl: true }), false);
  assert.equal(trackingAllowed({ webdriver: true }), false);
  assert.equal(trackingAllowed({ optedOut: true }), false);
  assert.equal(trackingAllowed({ doNotTrack: 'unspecified' }), true);
});

// ─── Painel: períodos e rótulos ──────────────────────────────────────────────

test('datas civis: dias, semanas (segunda) e meses', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(startOfWeek('2026-09-26'), '2026-09-21', 'sábado → segunda anterior');
  assert.equal(startOfWeek('2026-09-21'), '2026-09-21');
  assert.equal(startOfWeek('2026-09-27'), '2026-09-21', 'domingo pertence à semana que começou na segunda');
  assert.equal(addMonths('2026-01-01', -11), '2025-02-01');
});

test('localToday / localHour usam a hora de Maputo', () => {
  const lateUtc = new Date('2026-09-25T22:30:00Z'); // 00:30 de 26/9 em Maputo
  assert.equal(localToday(lateUtc), '2026-09-26');
  assert.equal(localToday(lateUtc, 'UTC'), '2026-09-25');
  assert.equal(localHour(lateUtc), 0);
  assert.equal(localDate('2026-09-25T21:59:00Z'), '2026-09-25');
  assert.equal(localClock(lateUtc), '00:30', '“Atualizado às” em hora de Maputo, seja qual for o fuso do computador');
  assert.equal(localClock('2026-09-26T10:05:00Z'), '12:05');
  assert.equal(localClock(lateUtc, 'Asia/Taipei'), '06:30');
});

test('elapsedSeries: “Hoje” só até à hora atual; outros períodos intactos', () => {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ bucket: `2026-09-26T${String(hour).padStart(2, '0')}:00`, visitors: 1 }));
  const now = new Date('2026-09-26T12:20:00Z'); // 14:20 em Maputo
  const today = elapsedSeries(hours, { bucket: 'hour', to: '2026-09-26' }, now);
  assert.equal(today.length, 15);
  assert.equal(today.at(-1).bucket, '2026-09-26T14:00');
  assert.equal(elapsedSeries(hours, { bucket: 'hour', to: '2026-09-26' }, new Date('2026-09-25T22:10:00Z')).length, 1, '00:10 → só a hora 0');
  assert.equal(elapsedSeries(hours, { bucket: 'hour', to: '2026-09-25' }, now).length, 24, 'um dia já passado fica completo');
  const days = [{ bucket: '2026-09-25T00:00' }, { bucket: '2026-09-26T00:00' }];
  assert.equal(elapsedSeries(days, { bucket: 'day', to: '2026-09-26' }, now), days);
});

test('periodRange: hoje, 30 dias, 12 semanas e 12 meses', () => {
  const today = '2026-09-26';
  assert.deepEqual(pick(periodRange('hoje', today)), { from: today, to: today, bucket: 'hour' });
  assert.deepEqual(pick(periodRange('diario', today)), { from: '2026-08-28', to: today, bucket: 'day' });
  assert.deepEqual(pick(periodRange('semanal', today)), { from: '2026-07-06', to: today, bucket: 'week' });
  assert.equal(new Date('2026-07-06T00:00:00Z').getUTCDay(), 1, 'as 12 semanas começam numa segunda');
  assert.deepEqual(pick(periodRange('mensal', today)), { from: '2025-10-01', to: today, bucket: 'month' });
  assert.equal(periodRange('inventado', today).bucket, 'day', 'período desconhecido → diário');
});
const pick = ({ from, to, bucket }) => ({ from, to, bucket });

test('bucketLabel e axisLabels em português', () => {
  assert.equal(bucketLabel('2026-09-26T14:00', 'hour'), '14h');
  assert.equal(bucketLabel('2026-09-26T23:00', 'hour', { long: true }), '23:00 – 00:00');
  assert.equal(bucketLabel('2026-09-26T00:00', 'day'), '26 set');
  assert.equal(bucketLabel('2026-09-26T00:00', 'day', { long: true }), 'sábado, 26 de setembro');
  assert.equal(bucketLabel('2026-09-21T00:00', 'week', { long: true }), 'Semana de 21 set a 27 set 2026');
  assert.equal(bucketLabel('2026-03-01T00:00', 'month', { long: true }), 'março de 2026');
  assert.deepEqual(axisLabels(['2025-11-01T00:00', '2025-12-01T00:00', '2026-01-01T00:00'], 'month'), ['nov 25', 'dez', 'jan 26']);
  assert.equal(periodCaption({ from: '2026-08-28', to: '2026-09-26', bucket: 'day' }), '28 ago – 26 set 2026 · por dia');
  assert.equal(periodCaption({ from: '2025-10-01', to: '2026-09-26', bucket: 'month' }), '1 out 2025 – 26 set 2026 · por mês');
});

test('delta e formatPercent', () => {
  assert.deepEqual(pickDelta(delta(120, 100)), ['up', '+20%']);
  assert.deepEqual(pickDelta(delta(50, 100)), ['down', '−50%']);
  assert.deepEqual(pickDelta(delta(10, 0)), ['up', 'Novo']);
  assert.deepEqual(pickDelta(delta(0, 0)), ['flat', '—']);
  assert.deepEqual(pickDelta(delta(100, 100)), ['flat', '0%']);
  assert.equal(formatPercent(0.034), '3,4%');
  assert.equal(formatPercent(0.25), '25%');
  assert.equal(formatPercent(0), '0%');
});
const pickDelta = ({ direction, label }) => [direction, label];

test('normalizeReport tolera respostas incompletas', () => {
  const report = normalizeReport({ totals: { visitors: '3', page_views: 5, funnel: { visitors: 3, sent_order: 1 } }, hours: [{ hour: 10, page_views: 2 }], series: [{ bucket: '2026-09-26T00:00', visitors: 3 }] });
  assert.equal(report.totals.visitors, 3);
  assert.equal(report.totals.addToCart, 0);
  assert.equal(report.previous.visitors, 0);
  assert.equal(report.hours.length, 24);
  assert.equal(report.hours[10], 2);
  assert.equal(report.series[0].pageViews, 0);
  assert.deepEqual(report.topProducts, []);
  assert.equal(normalizeReport(null).liveVisitors, 0);
});

test('funil, origens, dispositivos, páginas e hora de pico', () => {
  const steps = funnelSteps({ visitors: 200, viewedProduct: 100, addedToCart: 20, beganCheckout: 10, sentOrder: 5 });
  assert.equal(steps.length, 5);
  assert.equal(steps[2].ofFirst, 0.1);
  assert.equal(steps[2].ofPrevious, 0.2);
  assert.equal(funnelSteps({ visitors: 0 })[1].ofFirst, 0);
  assert.equal(sourceLabel(''), 'Direto / sem origem');
  assert.equal(sourceLabel('instagram.com'), 'Instagram');
  assert.equal(sourceLabel('google.co.mz'), 'Google');
  assert.equal(sourceLabel('blog.exemplo.mz'), 'blog.exemplo.mz');
  assert.deepEqual(groupSources([{ source: 'instagram.com', sessions: 3 }, { source: '', sessions: 5 }, { source: 'instagram', sessions: 4 }]).map(g => [g.label, g.sessions]),
    [['Instagram', 7], ['Direto / sem origem', 5]]);
  assert.equal(pageLabel('/'), 'Início');
  assert.equal(pageLabel('/Localizacao'), 'Localização');
  assert.equal(pageLabel('/produtos/polo-seven', new Map([['polo-seven', 'Polo Seven']])), 'Polo Seven');
  assert.equal(pageLabel('/produtos/antigo'), 'antigo');
  const hours = Array(24).fill(0);
  hours[20] = 9;
  assert.deepEqual(peakHour(hours), { hour: 20, value: 9, label: '20:00 – 21:00' });
  assert.equal(peakHour(Array(24).fill(0)), null);
});

test('ordersByDay agrupa pedidos por dia de Maputo e separa cancelados', () => {
  const points = ordersByDay([
    { created_at: '2026-09-24T21:30:00Z', total: 1500, status: 'novo' },     // 23:30 de 24/9
    { created_at: '2026-09-24T22:30:00Z', total: 2500, status: 'confirmado' }, // 00:30 de 25/9
    { created_at: '2026-09-25T10:00:00Z', total: 999, status: 'cancelado' },
    { created_at: '2026-09-01T10:00:00Z', total: 1, status: 'novo' }        // fora do intervalo
  ], '2026-09-24', '2026-09-26');
  assert.deepEqual(points, [
    { date: '2026-09-24', orders: 1, cancelled: 0, value: 1500 },
    { date: '2026-09-25', orders: 1, cancelled: 1, value: 2500 },
    { date: '2026-09-26', orders: 0, cancelled: 0, value: 0 }
  ]);
});

test('isMissingAnalytics reconhece a função em falta', () => {
  assert.equal(isMissingAnalytics({ code: 'PGRST202', message: 'Could not find the function public.analytics_report' }), true);
  assert.equal(isMissingAnalytics({ message: 'function public.analytics_report(date, date, text, text) does not exist' }), true);
  assert.equal(isMissingAnalytics({ code: '42501', message: 'FORBIDDEN' }), false);
  assert.equal(isMissingAnalytics(null), false);
});

// ─── Gráficos ────────────────────────────────────────────────────────────────

test('niceScale dá escalas redondas a partir de 0', () => {
  assert.deepEqual(niceScale(0), { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(3).ticks, [0, 1, 2, 3]);
  assert.deepEqual(niceScale(7).ticks, [0, 2, 4, 6, 8]);
  assert.deepEqual(niceScale(87).ticks, [0, 50, 100]);
  assert.deepEqual(niceScale(45000).ticks, [0, 20000, 40000, 60000]);
  assert.ok(niceScale(123).ticks.every(Number.isInteger));
});

test('labelIndices reduz os rótulos do eixo à largura disponível', () => {
  assert.deepEqual(labelIndices(7, 600), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(labelIndices(30, 300).length <= 5, true);
  assert.deepEqual(labelIndices(0, 300), []);
});

const spec = {
  id: 't',
  labels: ['1 set', '2 set', '3 set'],
  longLabels: ['segunda', 'terça', 'quarta'],
  summary: 'Visitantes <teste>.',
  series: [{ name: 'Visitantes', values: [2, 5, 0], tone: 1 }, { name: 'Páginas', values: [4, 9, 1], tone: 2 }],
  extra: index => [{ label: 'Adições', value: String(index) }]
};

test('lineChartSVG: pontos dentro da área, nome acessível escapado', () => {
  const chart = lineChartSVG(spec, 480);
  assert.equal(chart.xs.length, 3);
  assert.ok(chart.xs[0] >= chart.plot.left && chart.xs[2] <= chart.plot.right);
  assert.match(chart.svg, /aria-label="Visitantes &lt;teste&gt;\. Usa as setas/);
  assert.equal((chart.svg.match(/class="chart-line/g) ?? []).length, 2);
  assert.equal((chart.svg.match(/data-index="1"/g) ?? []).length, 2);
  assert.match(chart.svg, /url\(#t-fill\)/);
  assert.doesNotMatch(chart.svg, /NaN|undefined/);
  const flat = lineChartSVG({ ...spec, series: [{ name: 'x', values: [0, 0, 0] }] }, 320);
  assert.doesNotMatch(flat.svg, /NaN|Infinity/);
});

test('columnChartSVG: uma coluna por valor e zonas de toque', () => {
  const chart = columnChartSVG({ id: 'h', labels: Array.from({ length: 24 }, (_, h) => `${h}h`), series: [{ name: 'Vistas', values: Array.from({ length: 24 }, (_, h) => h % 5) }] }, 360);
  assert.equal((chart.svg.match(/class="chart-bar/g) ?? []).length, 24);
  assert.equal((chart.svg.match(/class="chart-hit"/g) ?? []).length, 24);
  assert.doesNotMatch(chart.svg, /NaN|undefined/);
});

test('tooltipHTML, donutHTML, barListHTML e sparklineSVG escapam o conteúdo', () => {
  const tip = tooltipHTML(spec, 1);
  assert.match(tip, /terça/);
  assert.match(tip, /<strong>5<\/strong>/);
  assert.match(tip, /Adições/);
  const donut = donutHTML({ segments: [{ label: 'Telemóvel', value: 3, tone: 1 }, { label: '<b>PC</b>', value: 1, tone: 2 }], centerLabel: 'visitantes', label: 'Dispositivos' });
  assert.match(donut, /75%/);
  assert.match(donut, /&lt;b&gt;PC&lt;\/b&gt;/);
  assert.doesNotMatch(donutHTML({ segments: [{ label: 'x', value: 0, tone: 1 }] }), /NaN/);
  const bars = barListHTML([{ label: 'Polo <Seven>', value: 10, href: '#/produtos/1' }, { label: 'Tee', value: 5 }]);
  assert.match(bars, /width:100%/);
  assert.match(bars, /width:50%/);
  assert.match(bars, /Polo &lt;Seven&gt;/);
  assert.equal(sparklineSVG([1]), '');
  assert.match(sparklineSVG([0, 2, 1]), /aria-hidden="true"/);
});
