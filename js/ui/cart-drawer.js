// Gaveta "O TEU PEDIDO", contador do header e painel "Adicionado ao teu pedido".
import { track } from '../analytics.js';
import { cart } from '../app-context.js';
import { describeCartChange } from '../lib/cart.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML } from '../lib/images.js';
import { $, $$, on, renderKeepingFocus } from './dom.js';
import { closeModal, openModal } from './dialogs.js';
import { cartLineHTML, emptyOrderHTML, icon, totalsHTML } from './templates.js';
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

function render(state) {
  renderCount(state.totals.quantity);
  if (!drawer) return;
  $('[data-cart-title-count]', drawer).textContent = state.totals.quantity ? `(${state.totals.quantity})` : '';
  const body = $('[data-cart-body]', drawer);
  const foot = $('[data-cart-foot]', drawer);
  if (!state.items.length) {
    body.innerHTML = emptyOrderHTML();
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
  try { cart.setQuantity(variantId, line.quantity + delta); }
  catch (error) { toast(error.message, { tone: 'error' }); }
}

function removeLine(variantId) {
  const element = drawer?.querySelector(`[data-line="${CSS.escape(variantId)}"]`);
  const finish = () => {
    const removed = cart.remove(variantId);
    if (removed) {
      track('remove_from_cart', { productId: removed.productId, variantId, quantity: removed.quantity });
      toast(`${removed.name} removida do teu pedido.`);
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
  on(drawer, 'click', '[data-line-inc]', (event, button) => changeQuantity(button.dataset.lineInc, 1));
  on(drawer, 'click', '[data-line-dec]', (event, button) => changeQuantity(button.dataset.lineDec, -1));
  on(drawer, 'click', '[data-line-remove]', (event, button) => removeLine(button.dataset.lineRemove));
  drawer.addEventListener('close', () => renderNotice([]));
}

// ------------------------------------------------------------------ Painel "Adicionado"

let addedTimer;

export function showAddedPanel(line, quantityAdded) {
  const panel = $('[data-added-panel]');
  if (!panel) return;
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
  if (!panel.open) panel.show();
  const close = () => { clearTimeout(addedTimer); if (panel.open) panel.close(); };
  $$('[data-added-close]', panel).forEach(button => button.addEventListener('click', close));
  $('[data-added-view]', panel).addEventListener('click', () => { close(); openCart(); });
  const schedule = () => { clearTimeout(addedTimer); addedTimer = setTimeout(close, 6000); };
  panel.onpointerenter = () => clearTimeout(addedTimer);
  panel.onpointerleave = schedule;
  panel.onfocusin = () => clearTimeout(addedTimer);
  panel.onkeydown = event => { if (event.key === 'Escape') close(); };
  schedule();
}

export { closeModal };
