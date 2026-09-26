// Gráficos do painel em SVG/HTML, sem bibliotecas: linhas com área, colunas, donut, barras horizontais,
// funil e sparklines. Cada gráfico interativo tem nome acessível, dica ao passar o rato / tocar / usar as
// setas do teclado, e a página mostra a tabela equivalente em "Ver dados".
// As funções *SVG/*HTML são puras (tests/analytics.test.js); mountChart() liga-as ao DOM e ao tamanho real.
// Imports RELATIVOS para funcionar em Node e no browser.
import { escapeHTML } from '../../js/lib/html.js';
import { formatCount } from './analytics-logic.js';

const round = value => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Escala "redonda" a partir de 0: passos de 1, 2 ou 5 × 10ⁿ (só inteiros — contagens e meticais).
export function niceScale(maxValue, maxTicks = 4) {
  const max = Math.max(0, Number(maxValue) || 0);
  let step = 1;
  if (max > maxTicks) {
    const rough = max / maxTicks;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    step = Math.max(1, [1, 2, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough));
  }
  const top = Math.max(step, Math.ceil(max / step) * step, max ? 0 : maxTicks);
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return { max: top, step, ticks };
}

// Índices dos rótulos do eixo X que cabem na largura (os outros ficam só na dica).
export function labelIndices(count, plotWidth, minGap = 64) {
  if (count <= 0) return [];
  const fit = Math.max(2, Math.floor(plotWidth / minGap));
  const step = Math.max(1, Math.ceil(count / fit));
  const indices = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  return indices;
}

function frame(spec, width, values) {
  const height = spec.height ?? 260;
  const scale = niceScale(Math.max(0, ...values));
  const formatTick = spec.formatTick ?? formatCount;
  const tickLabels = scale.ticks.map(formatTick);
  const left = Math.max(30, 12 + 7 * Math.max(...tickLabels.map(label => label.length)));
  const top = 14;
  const bottom = 30;
  const right = 14;
  const plot = { left, top, right: width - right, bottom: height - bottom, width: Math.max(20, width - left - right), height: height - top - bottom };
  const y = value => round(plot.bottom - (Math.max(0, value) / scale.max) * plot.height);
  const grid = scale.ticks.map((tick, index) => `<line class="chart-gridline" x1="${plot.left}" x2="${plot.right}" y1="${y(tick)}" y2="${y(tick)}"/>`
    + `<text class="chart-tick" x="${plot.left - 8}" y="${y(tick)}" text-anchor="end" dominant-baseline="middle">${escapeHTML(tickLabels[index])}</text>`).join('');
  return { height, scale, plot, y, grid };
}

function xAxis(labels, xs, plot) {
  return labelIndices(labels.length, plot.width).map(index => {
    const x = clamp(xs[index], plot.left + 12, plot.right - 12);
    return `<text class="chart-label" x="${round(x)}" y="${plot.bottom + 20}" text-anchor="middle">${escapeHTML(labels[index])}</text>`;
  }).join('');
}

const svgOpen = (spec, width, height) => `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${escapeHTML(`${spec.summary ?? spec.title ?? 'Gráfico'} Usa as setas para percorrer os valores.`)}">`;

// Linhas (uma ou mais séries) com área sob a primeira. spec: { id, labels, longLabels, series: [{ name, values, tone }] }
export function lineChartSVG(spec, width) {
  const labels = spec.labels ?? [];
  const series = spec.series ?? [];
  const { height, plot, y, grid } = frame(spec, width, series.flatMap(item => item.values));
  const count = labels.length;
  const xs = labels.map((_, index) => round(count <= 1 ? plot.left + plot.width / 2 : plot.left + (index * plot.width) / (count - 1)));
  const dots = count <= 14; // poucos pontos: sempre visíveis; muitos: só o ponto ativo
  const body = series.map((item, seriesIndex) => {
    const tone = item.tone ?? seriesIndex + 1;
    const points = item.values.map((value, index) => `${xs[index]},${y(value)}`);
    const line = points.length ? `M${points.join('L')}` : '';
    const area = seriesIndex === 0 && points.length > 1
      ? `<path class="chart-area" fill="url(#${spec.id}-fill)" d="M${xs[0]},${plot.bottom}L${points.join('L')}L${xs[count - 1]},${plot.bottom}Z"/>`
      : '';
    const circles = item.values.map((value, index) => `<circle class="chart-dot tone-${tone}${dots ? ' chart-dot-visible' : ''}" data-index="${index}" cx="${xs[index]}" cy="${y(value)}" r="3.5"/>`).join('');
    return `${area}<path class="chart-line tone-${tone}" d="${line}"/>${circles}`;
  }).join('');
  const fillTone = series[0]?.tone ?? 1;
  const svg = `${svgOpen(spec, width, height)}
    <defs><linearGradient id="${spec.id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="chart-stop tone-${fillTone}" stop-opacity=".26"/><stop offset="1" class="chart-stop tone-${fillTone}" stop-opacity="0"/></linearGradient></defs>
    <g aria-hidden="true">${grid}${xAxis(labels, xs, plot)}</g>
    <line class="chart-guide" x1="0" x2="0" y1="${plot.top}" y2="${plot.bottom}" visibility="hidden"/>
    <g aria-hidden="true">${body}</g>
  </svg>`;
  const anchors = xs.map((x, index) => ({ x, y: Math.min(...series.map(item => y(item.values[index] ?? 0))) }));
  return { svg, xs, anchors, plot, height };
}

// Colunas (uma série). spec: { id, labels, longLabels, series: [{ name, values, tone }] }
export function columnChartSVG(spec, width) {
  const labels = spec.labels ?? [];
  const item = spec.series?.[0] ?? { name: '', values: [] };
  const { height, plot, y, grid } = frame(spec, width, item.values);
  const count = Math.max(1, labels.length);
  const band = plot.width / count;
  const barWidth = round(Math.max(2, Math.min(38, band * 0.66)));
  const xs = labels.map((_, index) => round(plot.left + band * (index + 0.5)));
  const tone = item.tone ?? 1;
  const bars = item.values.map((value, index) => {
    const top = y(value);
    const barHeight = round(Math.max(value > 0 ? 2 : 0, plot.bottom - top));
    return `<rect class="chart-bar tone-${tone}" data-index="${index}" x="${round(xs[index] - barWidth / 2)}" y="${round(plot.bottom - barHeight)}" width="${barWidth}" height="${barHeight}" rx="${Math.min(4, barWidth / 3)}"/>`
      + `<rect class="chart-hit" data-index="${index}" x="${round(xs[index] - band / 2)}" y="${plot.top}" width="${round(band)}" height="${plot.height}"/>`;
  }).join('');
  const svg = `${svgOpen(spec, width, height)}
    <g aria-hidden="true">${grid}${xAxis(labels, xs, plot)}</g>
    <g aria-hidden="true">${bars}</g>
  </svg>`;
  const anchors = xs.map((x, index) => ({ x, y: y(item.values[index] ?? 0) }));
  return { svg, xs, anchors, plot, height };
}

// Conteúdo da dica de um ponto.
export function tooltipHTML(spec, index) {
  const format = spec.formatValue ?? formatCount;
  const rows = (spec.series ?? []).map((item, seriesIndex) => `<li><span class="chart-swatch tone-${item.tone ?? seriesIndex + 1}" aria-hidden="true"></span>`
    + `<span>${escapeHTML(item.name)}</span><strong>${escapeHTML(format(item.values[index] ?? 0))}</strong></li>`).join('');
  const extra = (spec.extra?.(index) ?? []).map(line => `<li class="chart-tooltip-extra"><span>${escapeHTML(line.label)}</span><strong>${escapeHTML(line.value)}</strong></li>`).join('');
  return `<p class="chart-tooltip-title">${escapeHTML(spec.longLabels?.[index] ?? spec.labels?.[index] ?? '')}</p><ul>${rows}${extra}</ul>`;
}

export function tooltipText(spec, index) {
  const format = spec.formatValue ?? formatCount;
  const parts = (spec.series ?? []).map(item => `${item.name}: ${format(item.values[index] ?? 0)}`);
  const extra = (spec.extra?.(index) ?? []).map(line => `${line.label}: ${line.value}`);
  return `${spec.longLabels?.[index] ?? spec.labels?.[index] ?? ''}. ${[...parts, ...extra].join('; ')}.`;
}

// Donut com legenda. segments: [{ label, value, tone }]
export function donutHTML({ segments, centerValue, centerLabel = '', format = formatCount, label = '' }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter(segment => segment.value > 0);
  const gap = visible.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = total ? visible.map(segment => {
    const length = (segment.value / total) * circumference;
    const dash = Math.max(0.5, length - gap);
    const arc = `<circle class="donut-arc tone-${segment.tone}" cx="60" cy="60" r="${radius}" stroke-dasharray="${round(dash)} ${round(circumference - dash)}" stroke-dashoffset="${round(-offset)}"/>`;
    offset += length;
    return arc;
  }).join('') : '';
  const legend = segments.map(segment => `<li><span class="chart-swatch tone-${segment.tone}" aria-hidden="true"></span><span class="donut-legend-label">${escapeHTML(segment.label)}</span>`
    + `<strong>${escapeHTML(format(segment.value))}</strong><span class="donut-legend-pct">${total ? `${Math.round((segment.value / total) * 100)}%` : '—'}</span></li>`).join('');
  const summary = `${label}: ${segments.map(segment => `${segment.label} ${format(segment.value)}`).join(', ')}.`;
  return `<div class="donut">
    <svg class="donut-svg" viewBox="0 0 120 120" role="img" aria-label="${escapeHTML(summary)}">
      <circle class="donut-track" cx="60" cy="60" r="${radius}"/>
      <g transform="rotate(-90 60 60)">${arcs}</g>
      <text class="donut-value" x="60" y="58" text-anchor="middle" dominant-baseline="middle">${escapeHTML(centerValue ?? format(total))}</text>
      <text class="donut-caption" x="60" y="76" text-anchor="middle">${escapeHTML(centerLabel)}</text>
    </svg>
    <ul class="donut-legend">${legend}</ul>
  </div>`;
}

// Barras horizontais (ranking). items: [{ label, href, value, sub, tone }]
export function barListHTML(items, { format = formatCount, valueLabel = '', label = '' } = {}) {
  const max = Math.max(0, ...items.map(item => item.value));
  const rows = items.map(item => {
    const width = max ? Math.max(2, Math.round((item.value / max) * 100)) : 0;
    const name = item.href ? `<a href="${escapeHTML(item.href)}">${escapeHTML(item.label)}</a>` : `<span>${escapeHTML(item.label)}</span>`;
    return `<li class="bar-list-item">
      <div class="bar-list-row"><span class="bar-list-label">${name}</span><span class="bar-list-value">${escapeHTML(format(item.value))}${valueLabel ? `<span class="sr-only"> ${escapeHTML(valueLabel)}</span>` : ''}</span></div>
      <div class="bar-list-track" aria-hidden="true"><span class="bar-list-fill tone-${item.tone ?? 1}" style="width:${width}%"></span></div>
      ${item.sub ? `<p class="bar-list-sub">${escapeHTML(item.sub)}</p>` : ''}
    </li>`;
  }).join('');
  return `<ol class="bar-list"${label ? ` aria-label="${escapeHTML(label)}"` : ''}>${rows}</ol>`;
}

// Funil. steps: [{ label, value, ofFirst, ofPrevious }] (de funnelSteps)
export function funnelHTML(steps, { formatPercent }) {
  return `<ol class="funnel">${steps.map((step, index) => `<li class="funnel-step">
    <div class="funnel-row"><span class="funnel-label">${escapeHTML(step.label)}</span><strong class="funnel-value">${escapeHTML(formatCount(step.value))}</strong></div>
    <div class="funnel-track" aria-hidden="true"><span class="funnel-fill" style="width:${step.value ? Math.max(2, Math.round(step.ofFirst * 100)) : 0}%"></span></div>
    <p class="funnel-sub">${index === 0 ? '100% dos visitantes' : `${escapeHTML(formatPercent(step.ofFirst))} dos visitantes · ${escapeHTML(formatPercent(step.ofPrevious))} da etapa anterior`}</p>
  </li>`).join('')}</ol>`;
}

// Mini-gráfico decorativo para os cartões (os números estão ao lado, por isso aria-hidden).
export function sparklineSVG(values, { tone = 1 } = {}) {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${round((index / (values.length - 1)) * 100)},${round(30 - (Math.max(0, value) / max) * 26)}`);
  return `<svg class="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<path class="sparkline-area tone-${tone}" d="M0,32L${points.join('L')}L100,32Z"/>`
    + `<path class="sparkline-line tone-${tone}" d="M${points.join('L')}" vector-effect="non-scaling-stroke"/></svg>`;
}

// ─── DOM ─────────────────────────────────────────────────────────────────────

// Desenha o gráfico com a largura real do contentor e volta a desenhar quando esta muda.
// spec.type: 'line' | 'columns'. Devolve uma função que desliga os observadores.
export function mountChart(container, spec) {
  let width = 0;
  let geometry = null;
  let active = -1;
  let pending = 0;
  const count = spec.labels?.length ?? 0;
  const svg = () => container.querySelector('svg');
  const tip = () => container.querySelector('.chart-tooltip');

  function clear() {
    active = -1;
    const element = svg();
    element?.querySelectorAll('.is-active').forEach(node => node.classList.remove('is-active'));
    element?.querySelector('.chart-guide')?.setAttribute('visibility', 'hidden');
    if (tip()) tip().hidden = true;
  }

  function show(index, announce = false) {
    if (!geometry || index < 0 || index >= count) return;
    const element = svg();
    element.querySelectorAll('.is-active').forEach(node => node.classList.remove('is-active'));
    element.querySelectorAll(`[data-index="${index}"]`).forEach(node => node.classList.add('is-active'));
    const x = geometry.xs[index];
    const guide = element.querySelector('.chart-guide');
    if (guide) {
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.removeAttribute('visibility');
    }
    const tooltip = tip();
    tooltip.innerHTML = tooltipHTML(spec, index);
    tooltip.hidden = false;
    const left = clamp(x - tooltip.offsetWidth / 2, 0, Math.max(0, width - tooltip.offsetWidth));
    const above = geometry.anchors[index].y - tooltip.offsetHeight - 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${above >= 0 ? above : geometry.anchors[index].y + 14}px`;
    active = index;
    if (announce) container.querySelector('[data-chart-live]').textContent = tooltipText(spec, index);
  }

  function draw() {
    pending = 0;
    const next = Math.floor(container.clientWidth);
    if (!next || next === width) return;
    width = next;
    geometry = spec.type === 'columns' ? columnChartSVG(spec, width) : lineChartSVG(spec, width);
    const previous = active;
    container.innerHTML = `${geometry.svg}<div class="chart-tooltip" hidden></div><p class="sr-only" aria-live="polite" data-chart-live></p>`;
    active = -1;
    if (previous >= 0) show(previous);
  }

  function indexAt(clientX) {
    const rect = svg().getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    geometry.xs.forEach((value, index) => { if (Math.abs(value - x) < Math.abs(geometry.xs[best] - x)) best = index; });
    return best;
  }

  const onPointer = event => {
    if (!geometry || !count || event.target.closest?.('.chart-tooltip')) return;
    const x = event.clientX - svg().getBoundingClientRect().left;
    if (x < geometry.plot.left - 12 || x > geometry.plot.right + 12) return;
    show(indexAt(event.clientX));
  };
  container.addEventListener('pointermove', onPointer);
  container.addEventListener('pointerdown', onPointer);
  container.addEventListener('pointerleave', () => { if (document.activeElement !== svg()) clear(); });
  container.addEventListener('focusin', event => {
    if (event.target === svg() && active < 0 && count) show(count - 1, true);
  });
  container.addEventListener('focusout', event => {
    if (!container.contains(event.relatedTarget)) clear();
  });
  container.addEventListener('keydown', event => {
    if (event.target !== svg() || !count) return;
    const moves = { ArrowRight: active + 1, ArrowUp: active + 1, ArrowLeft: active - 1, ArrowDown: active - 1, Home: 0, End: count - 1 };
    if (event.key === 'Escape') { clear(); return; }
    if (!(event.key in moves)) return;
    event.preventDefault();
    show(clamp(moves[event.key], 0, count - 1), true);
  });

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { if (!pending) pending = requestAnimationFrame(draw); })
    : null;
  observer?.observe(container);
  draw();
  return () => {
    observer?.disconnect();
    if (pending) cancelAnimationFrame(pending);
  };
}
