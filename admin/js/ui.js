// Utilitários de DOM partilhados pelas vistas do painel.
import { escapeHTML } from '/js/lib/html.js';
import { resolveImage } from '/js/lib/images.js';
import { orderStatusLabel } from '/config/site.js';
import { productStatusLabel, stockStatusLabel } from './logic.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function debounce(fn, ms = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// ─── Estados: a carregar / vazio / erro ─────────────────────────────────────

export function loadingHTML(text = 'A carregar…') {
  return `<div class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHTML(text)}</span></div>`;
}

export function emptyHTML(text, extraHTML = '') {
  return `<div class="state state-empty"><p>${escapeHTML(text)}</p>${extraHTML}</div>`;
}

export function errorHTML(message) {
  return `<div class="state state-error" role="alert"><p>${escapeHTML(message)}</p><button type="button" class="btn" data-retry>Tentar novamente</button></div>`;
}

// Mostra "a carregar", executa load() e chama render(dados). Em erro mostra a mensagem e "Tentar novamente".
// isAlive() evita pintar resultados de uma vista que entretanto foi substituída.
export function loadInto(container, { load, render, isAlive = () => true, loadingText, errorMessage }) {
  const run = async ({ focus = false } = {}) => {
    container.innerHTML = loadingHTML(loadingText);
    container.setAttribute('aria-busy', 'true');
    try {
      const data = await load();
      if (!isAlive()) return;
      container.removeAttribute('aria-busy');
      render(data);
    } catch (error) {
      if (!isAlive()) return;
      console.error(error);
      container.removeAttribute('aria-busy');
      container.innerHTML = errorHTML(errorMessage ? errorMessage(error) : 'Não foi possível carregar os dados.');
      const retry = container.querySelector('[data-retry]');
      retry.addEventListener('click', () => run({ focus: true }), { once: true });
      if (focus) retry.focus();
    }
  };
  return run();
}

// ─── Chips ───────────────────────────────────────────────────────────────────

export function chipHTML(label, tone = 'neutral', attributes = '') {
  return `<span class="chip chip-${escapeHTML(tone)}"${attributes}>${escapeHTML(label)}</span>`;
}

const PRODUCT_TONES = { active: 'ok', draft: 'neutral', archived: 'muted' };
const ORDER_TONES = { novo: 'info', confirmado: 'indigo', em_preparacao: 'warn', concluido: 'ok', cancelado: 'muted' };
const STOCK_TONES = { in: 'ok', low: 'warn', out: 'danger', unknown: 'neutral' };

export const productStatusChip = status => chipHTML(productStatusLabel(status), PRODUCT_TONES[status] ?? 'neutral');
export const orderStatusChip = status => chipHTML(orderStatusLabel(status), ORDER_TONES[status] ?? 'neutral');
export const stockTone = status => STOCK_TONES[status] ?? 'neutral';
export const stockChip = (status, attributes = '') => chipHTML(stockStatusLabel(status), stockTone(status), attributes);

// ─── Imagens ─────────────────────────────────────────────────────────────────

// Miniatura a partir de uma chave de assets/images ou de um URL completo.
export function thumbHTML(ref, { alt = '', size = 48, className = 'thumb' } = {}) {
  if (!ref) return `<span class="${className} thumb-empty" aria-hidden="true"></span>`;
  const image = resolveImage(ref);
  const srcset = image.srcset ? ` srcset="${escapeHTML(image.srcset)}" sizes="${size}px"` : '';
  return `<img class="${className}" src="${escapeHTML(image.src)}"${srcset} alt="${escapeHTML(alt)}" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}

// ─── Tabelas ─────────────────────────────────────────────────────────────────
// Em ecrãs estreitos as tabelas .table-cards passam a cartões (CSS); os roles ARIA explícitos mantêm a
// semântica de tabela quando o display muda.
// columns: [{ label, className }] · rows: [[{ html, className }]]

export function tableHTML({ caption, columns, rows, cards = true }) {
  const head = columns.map(column => `<th role="columnheader" scope="col"${column.className ? ` class="${column.className}"` : ''}>${escapeHTML(column.label)}</th>`).join('');
  const body = rows.map(cells => `<tr role="row">${cells.map((cell, index) => {
    const column = columns[index];
    const className = [column.className, cell.className].filter(Boolean).join(' ');
    return `<td role="cell" data-label="${escapeHTML(column.label)}"${className ? ` class="${className}"` : ''}>${cell.html}</td>`;
  }).join('')}</tr>`).join('');
  // O contentor pode ter scroll horizontal em ecrãs médios: focável para se poder percorrer com o teclado.
  return `<div class="table-wrap" role="region" tabindex="0" aria-label="${escapeHTML(caption || 'Tabela')}"><table class="table${cards ? ' table-cards' : ''}" role="table">`
    + `${caption ? `<caption class="sr-only">${escapeHTML(caption)}</caption>` : ''}`
    + `<thead role="rowgroup"><tr role="row">${head}</tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`;
}

// ─── Campos ──────────────────────────────────────────────────────────────────

export function setFieldError(input, errorElement, message) {
  if (errorElement) errorElement.textContent = message ?? '';
  if (!input) return;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

export function optionsHTML(options, selected) {
  return options.map(option => `<option value="${escapeHTML(option.value)}"${String(option.value) === String(selected ?? '') ? ' selected' : ''}>${escapeHTML(option.label)}</option>`).join('');
}
