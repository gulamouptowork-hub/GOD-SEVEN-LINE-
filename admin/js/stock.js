// Stock: grelha produto → cor → tamanho, com +/−, estado por variante e gravação em lote.
import { SITE_CONFIG } from '/config/site.js';
import { swatchColor } from '/js/lib/catalog.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  buildStockGroups, collectStockEdits, dbErrorMessage, filterStockGroups, parseWholeNumber, productStatusLabel,
  settleStockEdits, sizeLabel, stepStock, stockStatus, stockStatusLabel
} from './logic.js';
import { chipHTML, debounce, emptyHTML, loadInto, optionsHTML, stockTone } from './ui.js';

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'low', label: 'Stock baixo' },
  { value: 'out', label: 'Esgotado' },
  { value: 'unknown', label: 'Por definir' }
];

const plural = (count, one, many) => (count === 1 ? one : many.replace('#', count));

export function renderStock(ctx) {
  ctx.setTitle('Stock');
  const threshold = SITE_CONFIG.lowStockThreshold;
  const initialFilter = FILTERS.some(filter => filter.value === ctx.route.query.filtro) ? ctx.route.query.filtro : 'all';
  ctx.main.innerHTML = `
    <div class="page-head"><h1 tabindex="-1">Stock</h1></div>
    <p class="hint">Stock baixo = 1 a ${threshold} unidades. Vazio = por definir (a peça não pode ser encomendada). Produtos arquivados não aparecem. Usa as setas ↑/↓ num campo para somar ou tirar 1.</p>
    <div class="toolbar toolbar-sticky">
      <form class="toolbar-filters" role="search" aria-label="Filtrar stock" data-filters>
        <div class="field field-grow">
          <label for="stock-q">Pesquisar</label>
          <input id="stock-q" name="q" type="search" placeholder="Produto ou cor" autocomplete="off">
        </div>
        <div class="field">
          <label for="stock-filter">Mostrar</label>
          <select id="stock-filter" name="filter">${optionsHTML(FILTERS, initialFilter)}</select>
        </div>
      </form>
      <div class="toolbar-save">
        <p class="dirty-count" aria-live="polite" data-dirty>Sem alterações por guardar.</p>
        <button type="button" class="btn btn-primary" data-save disabled>Guardar alterações</button>
      </div>
    </div>
    <p class="form-status" role="status" data-status></p>
    <p class="form-status form-status-error" role="alert" data-alert></p>
    <div data-region></div>`;

  const filtersForm = ctx.main.querySelector('[data-filters]');
  const region = ctx.main.querySelector('[data-region]');
  const dirtyEl = ctx.main.querySelector('[data-dirty]');
  const saveButton = ctx.main.querySelector('[data-save]');
  const statusEl = ctx.main.querySelector('[data-status]');
  const alertEl = ctx.main.querySelector('[data-alert]');

  // original: valores gravados (id → stock|null) · raw: texto escrito nos campos alterados (id → texto)
  const state = { groups: null, original: {}, raw: {}, saving: false };

  ctx.setGuard(() => collectStockEdits(state.original, state.raw).dirty);

  const setStatus = (message, type = 'info') => {
    statusEl.textContent = type === 'error' ? '' : message;
    statusEl.className = `form-status${type === 'success' ? ' form-status-success' : ''}`;
    alertEl.textContent = type === 'error' ? message : '';
  };

  // Valor atual de uma variante: o texto editado (se válido) ou o valor gravado.
  function currentValue(id) {
    if (!Object.hasOwn(state.raw, id)) return state.original[id];
    const parsed = parseWholeNumber(state.raw[id]);
    return parsed.ok ? parsed.value : state.original[id];
  }

  function cellState(id) {
    const edited = Object.hasOwn(state.raw, id);
    const parsed = edited ? parseWholeNumber(state.raw[id]) : { ok: true, value: state.original[id] };
    return {
      invalid: !parsed.ok,
      error: parsed.ok ? '' : parsed.error,
      dirty: edited && parsed.ok && parsed.value !== state.original[id],
      status: stockStatus(parsed.ok ? parsed.value : state.original[id])
    };
  }

  const originalLabel = id => (Number.isInteger(state.original[id]) ? String(state.original[id]) : 'por definir');

  function cellHTML(group, color, variant) {
    const id = variant.id;
    const domId = `stock-${escapeHTML(id)}`;
    const info = cellState(id);
    const name = `${group.name}, ${color.color}, tamanho ${sizeLabel(variant.size)}`;
    const value = Object.hasOwn(state.raw, id) ? state.raw[id] : (Number.isInteger(state.original[id]) ? String(state.original[id]) : '');
    return `<div class="stock-cell${info.dirty ? ' is-dirty' : ''}${info.invalid ? ' is-invalid' : ''}" data-id="${escapeHTML(id)}">
      <label class="stock-size" for="${domId}"><span class="sr-only">Stock de ${escapeHTML(group.name)}, ${escapeHTML(color.color)}, tamanho </span>${escapeHTML(sizeLabel(variant.size))}</label>
      <div class="stepper">
        <button type="button" class="step" data-step="-1"><span aria-hidden="true">−</span><span class="sr-only">Tirar 1: ${escapeHTML(name)}</span></button>
        <input id="${domId}" class="stock-input" type="text" inputmode="numeric" autocomplete="off" value="${escapeHTML(value)}" placeholder="—" aria-describedby="${domId}-state ${domId}-note"${info.invalid ? ' aria-invalid="true"' : ''}>
        <button type="button" class="step" data-step="1"><span aria-hidden="true">+</span><span class="sr-only">Somar 1: ${escapeHTML(name)}</span></button>
      </div>
      <span id="${domId}-state" data-chip>${info.invalid ? chipHTML('INVÁLIDO', 'danger') : chipHTML(stockStatusLabel(info.status), stockTone(info.status))}</span>
      <span class="cell-note" id="${domId}-note" data-note>${info.invalid ? escapeHTML(info.error) : (info.dirty ? `Alterado (era ${escapeHTML(originalLabel(id))})` : '')}</span>
    </div>`;
  }

  function gridHTML(groups) {
    return groups.map((group, groupIndex) => `
      <section class="stock-product" aria-labelledby="stock-p-${groupIndex}">
        <div class="stock-product-head">
          <h2 id="stock-p-${groupIndex}"><a href="#/produtos/${encodeURIComponent(group.id)}">${escapeHTML(group.name || '(sem nome)')}</a></h2>
          ${group.status !== 'active' ? chipHTML(productStatusLabel(group.status), 'neutral') : ''}
        </div>
        ${group.colors.map((color, colorIndex) => `
          <div class="stock-color" role="group" aria-labelledby="stock-c-${groupIndex}-${colorIndex}">
            <h3 class="stock-color-name" id="stock-c-${groupIndex}-${colorIndex}"><span class="swatch" data-swatch="${escapeHTML(color.color)}" aria-hidden="true"></span>${escapeHTML(color.color)}</h3>
            <div class="stock-cells">${color.variants.map(variant => cellHTML(group, color, variant)).join('')}</div>
          </div>`).join('')}
      </section>`).join('');
  }

  function paintGrid() {
    if (!state.groups) return;
    if (!state.groups.length) {
      region.innerHTML = emptyHTML('Sem variantes para gerir.', '<p>Cria as variantes (cor e tamanho) no editor de cada produto.</p><p><a class="btn" href="#/produtos">Ir para Produtos</a></p>');
      return;
    }
    const filters = { q: filtersForm.elements.q.value, filter: filtersForm.elements.filter.value };
    const visible = filterStockGroups(state.groups, filters, variant => currentValue(variant.id));
    region.innerHTML = visible.length ? gridHTML(visible) : emptyHTML('Nenhuma variante corresponde ao filtro.');
    // Cor da amostra via CSSOM (sem atributos style inline, compatível com uma CSP estrita).
    for (const swatch of region.querySelectorAll('[data-swatch]')) swatch.style.backgroundColor = swatchColor(swatch.dataset.swatch);
  }

  function paintSummary() {
    const { changes, invalid } = collectStockEdits(state.original, state.raw);
    const parts = [];
    if (changes.length) parts.push(plural(changes.length, '1 alteração por guardar', '# alterações por guardar'));
    if (invalid.length) parts.push(plural(invalid.length, '1 valor inválido', '# valores inválidos'));
    dirtyEl.textContent = parts.length ? `${parts.join(' · ')}.` : 'Sem alterações por guardar.';
    saveButton.disabled = state.saving || (!changes.length && !invalid.length);
    saveButton.textContent = state.saving ? 'A guardar…' : 'Guardar alterações';
  }

  function refreshCell(cell) {
    const id = cell.dataset.id;
    const info = cellState(id);
    const input = cell.querySelector('input');
    cell.classList.toggle('is-dirty', info.dirty);
    cell.classList.toggle('is-invalid', info.invalid);
    if (info.invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    cell.querySelector('[data-chip]').innerHTML = info.invalid ? chipHTML('INVÁLIDO', 'danger') : chipHTML(stockStatusLabel(info.status), stockTone(info.status));
    cell.querySelector('[data-note]').textContent = info.invalid ? info.error : (info.dirty ? `Alterado (era ${originalLabel(id)})` : '');
  }

  function setRaw(cell, text) {
    state.raw[cell.dataset.id] = text;
    refreshCell(cell);
    paintSummary();
  }

  function step(cell, delta) {
    const input = cell.querySelector('input');
    const next = String(stepStock(input.value, delta));
    input.value = next;
    setRaw(cell, next);
  }

  async function save() {
    if (state.saving) return;
    const { changes, invalid } = collectStockEdits(state.original, state.raw);
    if (invalid.length) {
      setStatus(`Corrige ${plural(invalid.length, 'o valor inválido', 'os # valores inválidos')} antes de guardar (só algarismos, 0 ou mais; vazio = por definir).`, 'error');
      const first = region.querySelector('.stock-cell.is-invalid input');
      if (first) first.focus();
      else setStatus(`${plural(invalid.length, 'Há 1 valor inválido escondido', 'Há # valores inválidos escondidos')} pelo filtro atual. Escolhe “Todos” para o${invalid.length === 1 ? '' : 's'} corrigir.`, 'error');
      return;
    }
    if (!changes.length) return;
    state.saving = true;
    paintSummary();
    setStatus(`A guardar ${plural(changes.length, '1 alteração', '# alterações')}…`);
    // Os campos continuam editáveis: o que for escrito durante a gravação fica por guardar.
    const sent = Object.fromEntries(changes.map(change => [change.id, state.raw[change.id]]));
    let result;
    try {
      result = await ctx.api.updateVariantStocks(changes);
    } catch (error) {
      result = { saved: [], failed: changes.map(change => ({ ...change, error })) };
    }
    if (!ctx.alive()) return;
    Object.assign(state, settleStockEdits(state.original, state.raw, sent, result.saved));
    state.saving = false;
    for (const cell of region.querySelectorAll('.stock-cell')) refreshCell(cell);
    paintSummary();
    if (!result.failed.length) {
      setStatus(`${plural(result.saved.length, '1 alteração guardada', '# alterações guardadas')}.`, 'success');
    } else {
      const reasons = [...new Set(result.failed.map(failure => dbErrorMessage(failure.error)))].join(' ');
      setStatus(`${plural(result.saved.length, '1 alteração guardada', '# alterações guardadas')}; ${plural(result.failed.length, '1 falhou', '# falharam')}: ${reasons} As que falharam continuam assinaladas: tenta guardar de novo.`, 'error');
    }
  }

  // ── Eventos ──
  const debouncedPaint = debounce(paintGrid, 250);
  filtersForm.addEventListener('submit', event => event.preventDefault());
  filtersForm.elements.q.addEventListener('input', debouncedPaint);
  filtersForm.elements.filter.addEventListener('change', paintGrid);
  saveButton.addEventListener('click', save);

  region.addEventListener('input', event => {
    const cell = event.target.closest('.stock-cell');
    if (cell && event.target.matches('input')) setRaw(cell, event.target.value);
  });
  region.addEventListener('click', event => {
    const button = event.target.closest('button[data-step]');
    if (button) step(button.closest('.stock-cell'), Number(button.dataset.step));
  });
  region.addEventListener('keydown', event => {
    if (!event.target.matches('.stock-input')) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(event.target.closest('.stock-cell'), event.key === 'ArrowUp' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });

  loadInto(region, {
    load: () => ctx.api.stockProducts(),
    isAlive: ctx.alive,
    loadingText: 'A carregar stock…',
    errorMessage: error => `Não foi possível carregar o stock. ${dbErrorMessage(error)}`,
    render: products => {
      state.groups = buildStockGroups(products);
      state.original = {};
      for (const group of state.groups) {
        for (const color of group.colors) for (const variant of color.variants) state.original[variant.id] = variant.stock;
      }
      paintGrid();
      paintSummary();
    }
  });

  return () => debouncedPaint.cancel();
}
