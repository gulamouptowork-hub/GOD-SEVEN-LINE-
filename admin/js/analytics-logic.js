// Lógica pura da página "Visitantes" e dos gráficos do Dashboard (sem DOM, sem supabase).
// Datas como 'AAAA-MM-DD' no fuso da loja (Maputo, UTC+2, sem hora de verão). Testada em tests/analytics.test.js.
// Os imports são RELATIVOS para funcionar tanto em Node como no browser.
import { formatNumber } from '../../js/lib/format.js';

export const ANALYTICS_TIMEZONE = 'Africa/Maputo';

export const ANALYTICS_PERIODS = Object.freeze([
  Object.freeze({ id: 'hoje', label: 'Hoje', bucket: 'hour', unit: 'hora' }),
  Object.freeze({ id: 'diario', label: 'Diário', bucket: 'day', unit: 'dia', hint: 'Últimos 30 dias' }),
  Object.freeze({ id: 'semanal', label: 'Semanal', bucket: 'week', unit: 'semana', hint: 'Últimas 12 semanas' }),
  Object.freeze({ id: 'mensal', label: 'Mensal', bucket: 'month', unit: 'mês', hint: 'Últimos 12 meses' })
]);
export const DEFAULT_PERIOD = 'diario';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DAY_MS = 86400000;
const pad = value => String(value).padStart(2, '0');

// ─── Datas (dia civil, sem horas) ────────────────────────────────────────────

const toUTC = iso => {
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const fromUTC = ms => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, days) => fromUTC(toUTC(iso) + days * DAY_MS);
export const weekday = iso => new Date(toUTC(iso)).getUTCDay();
export const startOfWeek = iso => addDays(iso, -((weekday(iso) + 6) % 7)); // segunda-feira
export const startOfMonth = iso => `${String(iso).slice(0, 7)}-01`;
export function addMonths(iso, months) {
  const [year, month] = String(iso).split('-').map(Number);
  return fromUTC(Date.UTC(year, month - 1 + months, 1));
}
export const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

// Data de hoje no fuso da loja.
export function localToday(now = new Date(), timeZone = ANALYTICS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Hora local (0–23) de um instante, no fuso da loja.
export function localHour(date, timeZone = ANALYTICS_TIMEZONE) {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date instanceof Date ? date : new Date(date));
  return Number(hour) % 24;
}

export function localDate(date, timeZone = ANALYTICS_TIMEZONE) {
  return localToday(date instanceof Date ? date : new Date(date), timeZone);
}

export const periodById = id => ANALYTICS_PERIODS.find(period => period.id === id) ?? ANALYTICS_PERIODS.find(period => period.id === DEFAULT_PERIOD);

// Intervalo (datas locais, inclusive) e agrupamento de cada período.
export function periodRange(id, today) {
  const period = periodById(id);
  switch (period.id) {
    case 'hoje': return { period, from: today, to: today, bucket: 'hour' };
    case 'semanal': return { period, from: addDays(startOfWeek(today), -77), to: today, bucket: 'week' };
    case 'mensal': return { period, from: addMonths(startOfMonth(today), -11), to: today, bucket: 'month' };
    default: return { period, from: addDays(today, -29), to: today, bucket: 'day' };
  }
}

// ─── Rótulos ─────────────────────────────────────────────────────────────────

function shortDate(iso, withYear = false) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

// Rótulo de um ponto do gráfico. bucket vem do servidor como 'AAAA-MM-DDTHH:MM' (hora local).
export function bucketLabel(bucket, kind, { long = false, withYear = false } = {}) {
  const [date, time = '00:00'] = String(bucket).split('T');
  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(time.slice(0, 2));
  if (kind === 'hour') return long ? `${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00` : `${hour}h`;
  if (kind === 'week') {
    const end = addDays(date, 6);
    return long ? `Semana de ${shortDate(date)} a ${shortDate(end, true)}` : shortDate(date);
  }
  if (kind === 'month') return long ? `${MONTHS_LONG[month - 1]} de ${year}` : `${MONTHS[month - 1]}${withYear ? ` ${String(year).slice(2)}` : ''}`;
  return long ? `${WEEKDAYS_LONG[weekday(date)]}, ${day} de ${MONTHS_LONG[month - 1]}` : `${day} ${MONTHS[month - 1]}`;
}

// Rótulos curtos para o eixo; nos meses mostra o ano no primeiro ponto e em cada janeiro.
export function axisLabels(buckets, kind) {
  return buckets.map((bucket, index) => {
    const month = Number(String(bucket).slice(5, 7));
    return bucketLabel(bucket, kind, { withYear: kind === 'month' && (index === 0 || month === 1) });
  });
}

export function periodCaption({ from, to, bucket }) {
  if (bucket === 'hour') return `Hoje, ${shortDate(from, true)} · por hora`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const per = { day: 'por dia', week: 'por semana (seg. a dom.)', month: 'por mês' }[bucket] ?? '';
  return `${shortDate(from, !sameYear)} – ${shortDate(to, true)} · ${per}`;
}

export function comparisonCaption({ bucket }) {
  return bucket === 'hour'
    ? 'Comparação com ontem até à mesma hora.'
    : 'Comparação com o período anterior de igual duração (até ao mesmo momento).';
}

// ─── Números ─────────────────────────────────────────────────────────────────

export const formatCount = value => formatNumber(Math.round(Number(value) || 0));

export function formatPercent(ratio, digits = 1) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return '—';
  const percent = value * 100;
  const text = percent >= 10 || Number.isInteger(percent) ? String(Math.round(percent)) : percent.toFixed(digits).replace('.', ',');
  return `${text}%`;
}

export const ratio = (part, whole) => (Number(whole) > 0 ? (Number(part) || 0) / Number(whole) : 0);

// Variação face ao período anterior.
export function delta(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (!now && !before) return { direction: 'flat', label: '—', text: 'Sem dados neste nem no período anterior.' };
  if (!before) return { direction: 'up', label: 'Novo', text: 'Sem dados no período anterior.' };
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return { direction: 'flat', label: '0%', text: `Igual ao período anterior (${formatCount(before)}).` };
  const up = percent > 0;
  return {
    direction: up ? 'up' : 'down',
    label: `${up ? '+' : '−'}${formatCount(Math.abs(percent))}%`,
    text: `${up ? 'Mais' : 'Menos'} ${formatCount(Math.abs(percent))}% do que no período anterior (${formatCount(before)}).`
  };
}

// ─── Relatório ───────────────────────────────────────────────────────────────

const count = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);
const list = value => (Array.isArray(value) ? value : []);

function totalsOf(raw = {}) {
  const funnel = raw?.funnel ?? {};
  return {
    visitors: count(raw?.visitors),
    sessions: count(raw?.sessions),
    pageViews: count(raw?.page_views),
    productViews: count(raw?.product_views),
    addToCart: count(raw?.add_to_cart),
    beginCheckout: count(raw?.begin_checkout),
    whatsappOrders: count(raw?.whatsapp_orders),
    whatsappClicks: count(raw?.whatsapp_clicks),
    ordersRegistered: count(raw?.orders_registered),
    funnel: {
      visitors: count(funnel.visitors),
      viewedProduct: count(funnel.viewed_product),
      addedToCart: count(funnel.added_to_cart),
      beganCheckout: count(funnel.began_checkout),
      sentOrder: count(funnel.sent_order)
    }
  };
}

// Converte a resposta de analytics_report (snake_case, números como texto ou número) num objeto seguro.
export function normalizeReport(raw) {
  const report = raw ?? {};
  return {
    from: String(report.from ?? ''),
    to: String(report.to ?? ''),
    bucket: String(report.bucket ?? 'day'),
    generatedAt: report.generated_at ? new Date(report.generated_at) : null,
    firstEventAt: report.first_event_at ? new Date(report.first_event_at) : null,
    liveVisitors: count(report.live_visitors),
    totals: totalsOf(report.totals),
    previous: totalsOf(report.previous),
    series: list(report.series).map(point => ({
      bucket: String(point.bucket ?? ''),
      visitors: count(point.visitors),
      pageViews: count(point.page_views),
      productViews: count(point.product_views),
      addToCart: count(point.add_to_cart),
      whatsappOrders: count(point.whatsapp_orders)
    })),
    topProducts: list(report.top_products).map(item => ({
      slug: String(item.slug ?? ''),
      name: item.name ? String(item.name) : '',
      productId: item.product_id ? String(item.product_id) : '',
      status: item.status ? String(item.status) : '',
      views: count(item.views),
      visitors: count(item.visitors),
      adds: count(item.adds),
      whatsapp: count(item.whatsapp)
    })),
    topPages: list(report.top_pages).map(item => ({ path: String(item.path ?? ''), views: count(item.views), visitors: count(item.visitors) })),
    sources: list(report.sources).map(item => ({ source: String(item.source ?? ''), sessions: count(item.sessions) })),
    devices: list(report.devices).map(item => ({ device: String(item.device ?? ''), visitors: count(item.visitors) })),
    hours: Array.from({ length: 24 }, (_, hour) => count(list(report.hours).find(item => Number(item.hour) === hour)?.page_views))
  };
}

export const hasAnyData = report => Boolean(report.firstEventAt);

// supabase/analytics.sql ainda não foi executado: o PostgREST não encontra a função.
export function isMissingAnalytics(error) {
  const code = String(error?.code ?? '');
  const text = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase();
  if (code === 'PGRST202' || code === '42883' || code === '42P01') return true;
  return text.includes('analytics_') && (text.includes('could not find') || text.includes('does not exist') || text.includes('schema cache'));
}

export function funnelSteps(funnel) {
  const steps = [
    ['visitors', 'Visitaram a loja'],
    ['viewedProduct', 'Viram um produto'],
    ['addedToCart', 'Adicionaram ao pedido'],
    ['beganCheckout', 'Abriram o checkout'],
    ['sentOrder', 'Enviaram o pedido']
  ];
  const first = funnel?.visitors ?? 0;
  return steps.map(([key, label], index) => {
    const value = funnel?.[key] ?? 0;
    const previous = index ? funnel?.[steps[index - 1][0]] ?? 0 : value;
    return { key, label, value, ofFirst: ratio(value, first), ofPrevious: ratio(value, previous) };
  });
}

// ─── Origem, dispositivos e páginas ──────────────────────────────────────────

const SOURCE_NAMES = [
  [/(^|\.)instagram\.com$|^instagram$|^ig$/, 'Instagram'],
  [/(^|\.)facebook\.com$|^facebook$|^fb$/, 'Facebook'],
  [/(^|\.)google(\.[a-z]{2,3}){1,2}$|^google$|^com\.google\./, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)tiktok\.com$|^tiktok$/, 'TikTok'],
  [/(^|\.)wa\.me$|whatsapp/, 'WhatsApp'],
  [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X / Twitter'],
  [/(^|\.)linktr\.ee$|^linktree$/, 'Linktree'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|^youtube$/, 'YouTube'],
  [/(^|\.)vercel\.app$|(^|\.)vercel\.com$/, 'Vercel']
];

export function sourceLabel(source) {
  if (!source) return 'Direto / sem origem';
  return SOURCE_NAMES.find(([pattern]) => pattern.test(source))?.[1] ?? source;
}

// Junta origens com o mesmo nome (instagram.com + utm_source=instagram → Instagram).
export function groupSources(sources) {
  const groups = new Map();
  for (const { source, sessions } of sources) {
    const label = sourceLabel(source);
    const group = groups.get(label) ?? { label, sessions: 0, sources: [] };
    group.sessions += sessions;
    group.sources.push(source);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label, 'pt'));
}

const DEVICE_LABELS = { mobile: 'Telemóvel', tablet: 'Tablet', desktop: 'Computador' };
export const deviceLabel = device => DEVICE_LABELS[device] ?? 'Desconhecido';

const PAGE_LABELS = { '/': 'Início', '/produtos': 'Coleção', '/finalizar': 'Finalizar pedido', '/servicos': 'Serviços', '/sobre': 'Sobre', '/localizacao': 'Localização', '/contactos': 'Contactos' };

export function pageLabel(path, productNames = new Map()) {
  const clean = String(path || '/');
  const known = PAGE_LABELS[clean.toLowerCase()];
  if (known) return known;
  const product = /^\/produtos\/([^/]+)$/.exec(clean);
  if (product) return productNames.get(product[1]) || product[1];
  return clean;
}

export function peakHour(hours) {
  const max = Math.max(0, ...hours);
  if (!max) return null;
  const hour = hours.indexOf(max);
  return { hour, value: max, label: `${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00` };
}

// ─── Pedidos por dia (Dashboard) ─────────────────────────────────────────────

// orders: [{ created_at, total, status }] → um ponto por dia local entre from e to (inclusive).
// Pedidos cancelados contam à parte e não entram no valor.
export function ordersByDay(orders, from, to, timeZone = ANALYTICS_TIMEZONE) {
  const days = daysBetween(from, to) + 1;
  const points = Array.from({ length: Math.max(0, days) }, (_, index) => ({ date: addDays(from, index), orders: 0, cancelled: 0, value: 0 }));
  const byDate = new Map(points.map(point => [point.date, point]));
  for (const order of orders ?? []) {
    const point = byDate.get(localDate(order.created_at, timeZone));
    if (!point) continue;
    if (order.status === 'cancelado') {
      point.cancelled += 1;
      continue;
    }
    point.orders += 1;
    point.value += Number.isFinite(Number(order.total)) ? Number(order.total) : 0;
  }
  return points;
}

export function countBy(items, key) {
  const counts = new Map();
  for (const item of items ?? []) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return counts;
}
