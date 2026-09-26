// Gaveta "O TEU PEDIDO", contador do header e painel "Adicionado ao teu pedido".
import { track } from '../analytics.js';
import { cart } from '../app-context.js';
import { describeCartChange, unitsLabel } from '../lib/cart.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML } from '../lib/images.js';
import { $, $$, on, renderKeepingFocus } from './dom.js';
import { closeModal, isOpen, openModal, showDialog } from './dialogs.js';
import { cartLineHTML, cartLineLabel, emptyOrderHTML, icon, totalsHTML } from './templates.js';
import { toast } from './toast.js';

let drawer;
let lastQuantity = null;

const pieces = count => `${count} ${count === 1 ? 'peça' : 'peças'}`;

function renderCount(quantity) {
  $$('[data-cart-count]').forEach(element => {
    element.textContent = String(quantity);
    if (lastQuantity !== null && quantity > lastQuantity) {
      element.classList.remove('count-pop');
      void element.offsetWidth;
      element.classList.add('count-pop');
    }
  });
  $$('[data-cart-button]').forEach(button => button.setAttribute('aria-label', `Abrir o teu pedido, ${pieces(quantity)}`));
  lastQuantity = quantity;
}

function renderNotice(changes) {
  const notice = $('[data-cart-notice]', drawer);
  if (!notice) return;
  if (!changes?.length) { notice.hidden = true; notice.innerHTML = ''; return; }
  notice.hidden = false;
  notice.innerHTML = `<strong>Atualizámos o teu pedido:</strong><ul>${changes.map(change => `<li>${escapeHTML(describeCartChange(change))}</li>`).join('')}</ul>`;
}

// Região viva fixa na gaveta: o <output> de cada linha é recriado a cada render e os leitores de ecrã
// não anunciam regiões acabadas de inserir. (O toast fica inerte por trás do diálogo modal.)
function announce(message) {
  const region = $('[data-cart-live]', drawer);
  if (region) region.textContent = message;
}

const totalLabel = totals => (totals.quantity ? ` Total: ${formatPrice(totals.total)}.` : '');

function render(state) {
  renderCount(state.totals.quantity);
  if (!drawer) return;
  $('[data-cart-title-count]', drawer).textContent = state.totals.quantity ? `(${state.totals.quantity})` : '';
  const body = $('[data-cart-body]', drawer);
  const foot = $('[data-cart-foot]', drawer);
  if (!state.items.length) {
    renderKeepingFocus(body, emptyOrderHTML());
    foot.hidden = true;
    foot.innerHTML = '';
    return;
  }
  renderKeepingFocus(body, `<ul class="cart-lines">${state.items.map(line => cartLineHTML(line, { productsLoaded: state.productsLoaded })).join('')}</ul>`);
  foot.hidden = false;
  foot.innerHTML = `${totalsHTML(state.totals)}
    <p class="cart-note">Disponibilidade e entrega confirmadas contigo pelo WhatsApp.</p>
    <div class="cart-actions">
      <button type="button" class="button button--ghost" data-dialog-close>Continuar a escolher</button>
      <a class="button" href="/finalizar" data-checkout-link>Finalizar pedido ${icon('arrow')}</a>
    </div>`;
}

function changeQuantity(variantId, delta) {
  const line = cart.getItems().find(item => item.variantId === variantId);
  if (!line) return;
  try {
    cart.setQuantity(variantId, line.quantity + delta);
    const state = cart.getState();
    const updated = state.items.find(item => item.variantId === variantId);
    if (updated) announce(`${cartLineLabel(updated)}: ${unitsLabel(updated.quantity)}.${totalLabel(state.totals)}`);
  } catch (error) { toast(error.message, { tone: 'error' }); }
}

function removeLine(variantId) {
  const element = drawer?.querySelector(`[data-line="${CSS.escape(variantId)}"]`);
  const finish = () => {
    const removed = cart.remove(variantId);
    if (removed) {
      track('remove_from_cart', { productId: removed.productId, variantId, quantity: removed.quantity });
      toast(`${removed.name} removida do teu pedido.`);
      announce(`${cartLineLabel(removed)} removida do teu pedido.${totalLabel(cart.getState().totals)}`);
    }
  };
  if (element && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.classList.add('is-leaving');
    setTimeout(finish, 220);
  } else finish();
}

export function openCart() {
  openModal(drawer, { focus: '[data-dialog-close]' });
}

export function setupCartUI() {
  drawer = $('[data-cart-drawer]');
  cart.subscribe((state, detail) => {
    render(state);
    if (detail.reason === 'reconcile' && detail.changes?.length) {
      renderNotice(detail.changes);
      toast('Atualizámos o teu pedido com o stock e os preços atuais.');
    }
  });
  render(cart.getState());
  on(document, 'click', '[data-cart-open]', () => openCart());
  if (!drawer) return;
  drawer.insertAdjacentHTML('beforeend', '<p class="sr-only" role="status" data-cart-live></p>');
  on(drawer, 'click', '[data-line-inc]', (event, button) => changeQuantity(button.dataset.lineInc, 1));
  on(drawer, 'click', '[data-line-dec]', (event, button) => changeQuantity(button.dataset.lineDec, -1));
  on(drawer, 'click', '[data-line-remove]', (event, button) => removeLine(button.dataset.lineRemove));
  drawer.addEventListener('close', () => { renderNotice([]); announce(''); });
}

// ------------------------------------------------------------------ Painel "Adicionado"

let addedTimer;
let addedPanelBound = false;

// Com o foco do teclado lá dentro, o painel não fecha sozinho (WCAG 2.2.1): quem usa teclado ou leitor
// de ecrã fecha-o quando quiser. Com o rato, os 6 s param enquanto o ponteiro está por cima.
function keyboardFocusInside(panel) {
  const active = document.activeElement;
  if (!panel.contains(active)) return false;
  try { return active.matches(':focus-visible'); } catch { return true; }
}

function closeAddedPanel(panel) {
  clearTimeout(addedTimer);
  closeModal(panel);
}

function scheduleAddedClose(panel) {
  clearTimeout(addedTimer);
  if (isOpen(panel) && !keyboardFocusInside(panel)) addedTimer = setTimeout(() => closeAddedPanel(panel), 6000);
}

// Ouvintes registados uma só vez — o conteúdo do painel é redesenhado a cada peça adicionada.
function bindAddedPanel(panel) {
  on(panel, 'click', '[data-added-close]', () => closeAddedPanel(panel));
  on(panel, 'click', '[data-added-view]', () => { closeAddedPanel(panel); openCart(); });
  panel.addEventListener('pointerenter', () => clearTimeout(addedTimer));
  panel.addEventListener('pointerleave', () => scheduleAddedClose(panel));
  panel.addEventListener('focusin', () => { if (keyboardFocusInside(panel)) clearTimeout(addedTimer); });
  panel.addEventListener('focusout', event => { if (!panel.contains(event.relatedTarget)) scheduleAddedClose(panel); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') closeAddedPanel(panel); });
}

export function showAddedPanel(line, quantityAdded) {
  const panel = $('[data-added-panel]');
  if (!panel) return;
  if (!addedPanelBound) { bindAddedPanel(panel); addedPanelBound = true; }
  clearTimeout(addedTimer);
  panel.innerHTML = `<div class="added-panel__head">
      <h2 id="added-title">${icon('check')}Adicionado ao teu pedido</h2>
      <button class="icon-button" type="button" data-added-close aria-label="Fechar">${icon('close')}</button>
    </div>
    <div class="added-panel__item">
      ${imgHTML(line.image, { alt: '', sizes: '64px', loading: 'eager' })}
      <div>
        <strong>${escapeHTML(line.name)}</strong>
        <p>${escapeHTML([line.size || 'Único', line.color].join(' / '))}</p>
        <p>${quantityAdded} × ${formatPrice(line.unitPrice)}</p>
      </div>
    </div>
    <div class="added-panel__actions">
      <button type="button" class="button button--ghost" data-added-close>Continuar a escolher</button>
      <button type="button" class="button" data-added-view>Ver pedido ${icon('arrow')}</button>
    </div>`;
  showDialog(panel);
  scheduleAddedClose(panel);
}

export { closeModal };
