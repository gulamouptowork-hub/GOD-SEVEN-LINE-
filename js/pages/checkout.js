// Finalizar pedido: 1 Dados → 2 Resumo → 3 WhatsApp.
// Antes de abrir o WhatsApp: revalida o catálogo (fresco), cria o pedido (Supabase ou local) e só depois navega.
import { track } from '../analytics.js';
import { cart, catalog } from '../app-context.js';
import { SITE_CONFIG, deliveryOption } from '../../config/site.js';
import { describeCartChange } from '../lib/cart.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { buildOrderDraft } from '../lib/order.js';
import { DEFAULT_DELIVERY, LIMITS, formatPhone, validateCustomer } from '../lib/validation.js';
import { buildOrderMessage, buildWhatsAppURL } from '../lib/whatsapp.js';
import { friendlyOrderError, loadLastOrder, saveLastOrder, submitOrder } from '../services/orders.js';
import { runtime } from '../services/runtime.js';
import { openCart } from '../ui/cart-drawer.js';
import { $, $$, isCoarsePointer, on } from '../ui/dom.js';
import { cartLineHTML, emptyOrderHTML, icon, totalsHTML } from '../ui/templates.js';
import { toast } from '../ui/toast.js';

const STEPS = { details: 1, review: 2, done: 3 };
const HASH = { details: '#dados', review: '#resumo', done: '#whatsapp' };

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SITE_CONFIG.storageKeys.checkout) ?? 'null') ?? {}; } catch { return {}; }
}
function writeSession(data) {
  try { sessionStorage.setItem(SITE_CONFIG.storageKeys.checkout, JSON.stringify(data)); } catch { /* sem storage */ }
}

export async function init() {
  const root = $('[data-checkout]');
  if (!root) return;
  const main = $('[data-checkout-main]', root);
  const aside = $('[data-checkout-aside]', root);
  const grid = $('[data-checkout-grid]', root);
  const back = $('[data-checkout-back]', root);
  const session = readSession();
  let customer = { name: '', phone: '', location: '', deliveryType: DEFAULT_DELIVERY, notes: '', ...(session.customer ?? {}) };
  let step = 'details';
  let sending = false;
  let notice = [];

  // ---------------------------------------------------------------- helpers de UI
  function setStep(next, { push = true } = {}) {
    step = next;
    grid.dataset.step = next;
    $$('[data-step]', root).forEach(item => {
      const n = Number(item.dataset.step);
      if (n === STEPS[next]) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', n < STEPS[next]);
    });
    if (push && location.hash !== HASH[next]) history.pushState({ step: next }, '', HASH[next]);
    writeSession({ step: next, customer });
    back.querySelector('span').textContent = next === 'review' ? 'Editar dados' : 'Voltar';
    back.href = next === 'review' ? HASH.details : '/produtos';
  }

  function focusMain() {
    main.focus({ preventScroll: true });
    root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderAside({ editable = false } = {}) {
    const state = cart.getState();
    grid.classList.toggle('is-single', false);
    aside.innerHTML = `<div class="checkout__aside-head"><h2 id="checkout-aside-title">O teu pedido (${state.totals.quantity})</h2><button type="button" class="text-button" data-edit-cart>Editar</button></div>
      <ul class="cart-lines">${state.items.map(line => cartLineHTML(line, { editable })).join('')}</ul>
      ${totalsHTML(state.totals)}`;
  }

  function noticeHTML() {
    if (!notice.length) return '';
    return `<div class="review-notice" role="alert"><strong>Atualizámos o teu pedido antes de enviar:</strong><ul>${notice.map(change => `<li>${escapeHTML(describeCartChange(change))}</li>`).join('')}</ul></div>`;
  }

  function renderEmpty() {
    grid.classList.add('is-single');
    aside.innerHTML = '';
    main.innerHTML = `<div class="checkout-empty">${emptyOrderHTML()}</div>`;
  }

  // ---------------------------------------------------------------- 1. Dados
  function field({ name, label, required = false, type = 'text', autocomplete, inputmode, placeholder = '', hint = '', full = false, max }) {
    const id = `checkout-${name}`;
    const describedBy = [hint && `${id}-hint`, `${id}-error`].filter(Boolean).join(' ');
    return `<div class="field${full ? ' field--full' : ''}" data-field="${name}">
      <label for="${id}">${label}${required ? ' <span class="required" aria-hidden="true">*</span>' : ''}<span data-required-mark="${name}"></span></label>
      <input id="${id}" name="${name}" type="${type}" value="${escapeHTML(customer[name] ?? '')}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}${placeholder ? ` placeholder="${escapeHTML(placeholder)}"` : ''}${required ? ' required aria-required="true"' : ''}${max ? ` maxlength="${max}"` : ''} aria-describedby="${describedBy}">
      ${hint ? `<p class="field__hint" id="${id}-hint">${hint}</p>` : ''}
      <p class="field__error" id="${id}-error"></p>
    </div>`;
  }

  function renderDetails() {
    const state = cart.getState();
    if (!state.items.length) { renderEmpty(); return; }
    main.innerHTML = `<p class="eyebrow">FINALIZAR / O TEU PEDIDO</p>
      <h2 class="checkout__title">Quase lá.</h2>
      <p class="checkout__lead">Preenche os teus dados para prepararmos a mensagem do teu pedido.</p>
      <form class="checkout-form" data-customer-form novalidate>
        <p class="form-error field--full" data-form-error role="alert"></p>
        ${field({ name: 'name', label: 'Nome completo', required: true, autocomplete: 'name', max: LIMITS.name, full: true })}
        ${field({ name: 'phone', label: 'Telefone', required: true, type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '84 123 4567', hint: 'Número de Moçambique ou internacional com indicativo (ex.: +27…).' })}
        ${field({ name: 'location', label: 'Localização / Bairro', autocomplete: 'address-level2', placeholder: 'Ex.: Manhiça, Maputo — bairro', max: LIMITS.location })}
        <fieldset class="field" data-field="deliveryType" aria-describedby="checkout-deliveryType-error">
          <legend>Forma de entrega <span class="required" aria-hidden="true">*</span></legend>
          <div class="delivery-options">${SITE_CONFIG.deliveryOptions.map(option => `
            <label class="delivery-option">
              <input type="radio" name="deliveryType" value="${option.id}"${customer.deliveryType === option.id ? ' checked' : ''} required>
              <span><strong>${escapeHTML(option.label)}</strong><small>${escapeHTML(option.hint)}</small></span>
            </label>`).join('')}
          </div>
          <p class="field__error" id="checkout-deliveryType-error"></p>
        </fieldset>
        <div class="field field--full" data-field="notes">
          <label for="checkout-notes">Observações</label>
          <textarea id="checkout-notes" name="notes" rows="3" maxlength="${LIMITS.notes}" placeholder="Horário, ponto de referência ou outra informação útil…" aria-describedby="checkout-notes-count checkout-notes-error">${escapeHTML(customer.notes)}</textarea>
          <p class="field__counter" id="checkout-notes-count" aria-live="polite">${customer.notes.length}/${LIMITS.notes}</p>
          <p class="field__error" id="checkout-notes-error"></p>
        </div>
        <button type="submit" class="button button--block">Continuar ${icon('arrow')}</button>
      </form>`;
    renderAside();
    syncLocationRequired();
  }

  function formValues(form) {
    const data = new FormData(form);
    return { name: data.get('name') ?? '', phone: data.get('phone') ?? '', location: data.get('location') ?? '', deliveryType: data.get('deliveryType') ?? '', notes: data.get('notes') ?? '' };
  }

  function syncLocationRequired() {
    const form = $('[data-customer-form]', main);
    if (!form) return;
    const required = Boolean(deliveryOption(new FormData(form).get('deliveryType'))?.requiresLocation);
    const input = $('[name="location"]', form);
    input.required = required;
    input.setAttribute('aria-required', String(required));
    $('[data-required-mark="location"]', form).innerHTML = required ? ' <span class="required" aria-hidden="true">*</span>' : '';
  }

  function showErrors(form, errors) {
    for (const name of ['name', 'phone', 'location', 'deliveryType', 'notes']) {
      const container = $(`[data-field="${name}"]`, form);
      const message = errors[name] ?? '';
      $(`#checkout-${name}-error`, form).textContent = message;
      $$('input, textarea', container).forEach(input => {
        if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      });
    }
    const count = Object.keys(errors).length;
    $('[data-form-error]', form).textContent = count ? `Revê ${count === 1 ? 'o campo assinalado' : `os ${count} campos assinalados`}.` : '';
    const first = ['name', 'phone', 'location', 'deliveryType', 'notes'].find(name => errors[name]);
    if (first) $(`[data-field="${first}"] input, [data-field="${first}"] textarea`, form)?.focus();
  }

  on(main, 'submit', '[data-customer-form]', event => {
    event.preventDefault();
    const form = event.target;
    const { valid, errors, value } = validateCustomer(formValues(form));
    customer = { ...customer, ...value };
    writeSession({ step, customer });
    if (!valid) { showErrors(form, errors); return; }
    customer.phone = formatPhone(customer.phone);
    notice = [];
    renderReview();
    setStep('review');
    focusMain();
  });
  on(main, 'change', 'input[name="deliveryType"]', () => {
    syncLocationRequired();
    const form = $('[data-customer-form]', main);
    customer = { ...customer, ...formValues(form) };
    writeSession({ step, customer });
  });
  on(main, 'input', '[data-customer-form] input, [data-customer-form] textarea', (event, input) => {
    customer = { ...customer, [input.name]: input.value };
    writeSession({ step, customer });
    if (input.name === 'notes') $('#checkout-notes-count', main).textContent = `${input.value.length}/${LIMITS.notes}`;
    if (input.getAttribute('aria-invalid') === 'true') {
      const { errors } = validateCustomer({ ...customer });
      if (!errors[input.name]) {
        input.removeAttribute('aria-invalid');
        $(`#checkout-${input.name}-error`, main).textContent = '';
      }
    }
  });
  on(main, 'focusout', 'input[name="phone"]', (event, input) => {
    const formatted = formatPhone(input.value);
    if (formatted && formatted !== input.value && validateCustomer({ ...customer, phone: input.value }).errors.phone === undefined) input.value = formatted;
  });

  // ---------------------------------------------------------------- 2. Resumo
  function renderReview() {
    const state = cart.getState();
    if (!state.items.length) { renderEmpty(); return; }
    const option = deliveryOption(customer.deliveryType);
    const rows = [
      ['Nome', customer.name], ['Telefone', customer.phone], ['Localização', customer.location || 'Não indicada'],
      ['Entrega', option?.label ?? customer.deliveryType], ['Observações', customer.notes || '—']
    ];
    main.innerHTML = `<p class="eyebrow">PASSO 2 / 3</p>
      <h2 class="checkout__title">Resumo do pedido.</h2>
      <p class="checkout__lead">Confere se está tudo certo antes de enviar.</p>
      <div class="review-grid">
        ${noticeHTML()}
        <section class="review-card" aria-labelledby="review-customer-title">
          <div class="review-card__head"><h2 id="review-customer-title">Dados do cliente</h2><button type="button" class="text-button" data-edit-details>Editar</button></div>
          <dl class="review-list">${rows.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl>
        </section>
      </div>
      <p class="form-error" data-send-error role="alert"></p>
      <div class="review-send">
        <button type="button" class="button button--block button--whatsapp" data-send>${icon('whatsapp')}<span>Enviar pedido pelo WhatsApp</span>${icon('arrow')}</button>
        <p>Será gerada uma mensagem automática com todos os detalhes do teu pedido. Confirmamos a disponibilidade e a entrega contigo.</p>
      </div>`;
    renderAside();
  }

  async function send(button) {
    if (sending) return;
    sending = true;
    const error = $('[data-send-error]', main);
    error.textContent = '';
    button.classList.add('is-loading');
    button.disabled = true;
    // No desktop abre-se já o separador (gesto do utilizador) para não ser bloqueado como pop-up;
    // no telemóvel navega-se no próprio separador para abrir a app do WhatsApp.
    const desktop = !isCoarsePointer();
    let popup = null;
    if (desktop) {
      try { popup = window.open('', '_blank'); } catch { popup = null; }
      if (popup) popup.document.write('<title>A abrir o WhatsApp…</title><p style="font:16px sans-serif;padding:24px">A preparar o teu pedido God Seven Line…</p>');
    }
    try {
      const { changes } = await catalog({ fresh: true });
      if (!cart.getItems().length) { popup?.close(); renderEmpty(); return; }
      if (changes.length) {
        popup?.close();
        notice = changes;
        renderReview();
        focusMain();
        return;
      }
      const draft = buildOrderDraft(cart.getItems(), customer);
      const order = await submitOrder(draft);
      const message = buildOrderMessage(order, { demo: runtime.demo });
      const whatsappUrl = buildWhatsAppURL(runtime.whatsappNumber, message);
      const record = { ...order, message, whatsappUrl };
      saveLastOrder(record);
      track('whatsapp_checkout', { orderNumber: order.orderNumber, value: order.total, items: order.quantity, persistence: order.persistence });
      cart.clear();
      renderDone(record);
      setStep('done');
      focusMain();
      if (popup && !popup.closed) {
        popup.opener = null;
        popup.location.replace(whatsappUrl);
      } else if (!desktop) {
        location.href = whatsappUrl;
      }
    } catch (failure) {
      popup?.close();
      if (['STOCK_INSUFFICIENT', 'PRICE_CHANGED', 'PRODUCT_UNAVAILABLE'].includes(failure?.code)) {
        try { notice = (await catalog({ fresh: true })).changes; } catch { /* mantém o aviso abaixo */ }
        renderReview();
        $('[data-send-error]', main).textContent = friendlyOrderError(failure);
        focusMain();
      } else {
        error.textContent = `${friendlyOrderError(failure)} Tenta novamente.`;
      }
    } finally {
      sending = false;
      if (button.isConnected) { button.classList.remove('is-loading'); button.disabled = false; }
    }
  }

  on(main, 'click', '[data-send]', (event, button) => send(button));
  on(root, 'click', '[data-edit-details]', () => { renderDetails(); setStep('details'); focusMain(); });
  on(root, 'click', '[data-edit-cart]', () => openCart());
  back.addEventListener('click', event => {
    if (step !== 'review') return;
    event.preventDefault();
    renderDetails();
    setStep('details');
    focusMain();
  });

  // ---------------------------------------------------------------- 3. WhatsApp
  function renderDone(order) {
    grid.classList.add('is-single');
    aside.innerHTML = '';
    main.innerHTML = `<div class="checkout-success">
      <span class="checkout-success__mark" aria-hidden="true">${icon('check')}</span>
      <p class="eyebrow">PEDIDO #${escapeHTML(order.orderNumber)}</p>
      <h2 class="checkout__title">Pedido preparado.</h2>
      <p class="checkout__lead">Abrimos o WhatsApp com a mensagem pronta — só falta tocares em <strong>enviar</strong>. Total: <strong>${formatPrice(order.total)}</strong>.</p>
      <a class="button button--whatsapp" href="${escapeHTML(order.whatsappUrl)}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Abrir WhatsApp</span>${icon('arrow')}</a>
      <ol class="checkout-success__steps">
        <li>Envia a mensagem no WhatsApp.</li>
        <li>Confirmamos contigo a disponibilidade das peças e a entrega.</li>
        <li>Veste a tua história.</li>
      </ol>
      <details>
        <summary>Ver a mensagem do pedido</summary>
        <pre>${escapeHTML(order.message)}</pre>
        <button type="button" class="text-button" data-copy>Copiar mensagem</button>
      </details>
      <a class="text-link" href="/produtos">Voltar à coleção ↗</a>
    </div>`;
    $('[data-copy]', main)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(order.message); toast('Mensagem copiada.'); }
      catch { toast('Não foi possível copiar. Seleciona o texto manualmente.', { tone: 'error' }); }
    });
  }

  // ---------------------------------------------------------------- navegação entre passos
  function renderStep(target) {
    const hasItems = cart.getItems().length > 0;
    const last = loadLastOrder();
    if (target === 'done' && last?.whatsappUrl && !hasItems) { renderDone(last); setStep('done', { push: false }); return; }
    if (!hasItems) { renderEmpty(); setStep('details', { push: false }); return; }
    if (target === 'review' && validateCustomer(customer).valid) { renderReview(); setStep('review', { push: false }); return; }
    renderDetails();
    setStep('details', { push: false });
  }

  window.addEventListener('popstate', () => {
    const target = Object.entries(HASH).find(([, hash]) => hash === location.hash)?.[0] ?? 'details';
    renderStep(target);
  });

  // Atualiza a lista lateral quando o pedido muda (ex.: editado na gaveta).
  cart.subscribe((state, detail) => {
    if (step === 'done' || detail.reason === 'clear') return;
    if (!state.items.length) { renderEmpty(); return; }
    if (aside.innerHTML) renderAside();
  });

  try {
    await catalog();
  } catch {
    main.innerHTML = `<div class="catalog-state" role="alert"><h2>Não foi possível carregar os produtos.</h2><p>Precisamos de confirmar preços e stock antes de finalizar.</p><button type="button" class="button" data-reload>Tentar novamente</button></div>`;
    $('[data-reload]', main).addEventListener('click', () => location.reload());
    return;
  }
  const initial = Object.entries(HASH).find(([, hash]) => hash === location.hash)?.[0] ?? session.step ?? 'details';
  renderStep(initial);
  if (cart.getItems().length) track('begin_checkout', { value: cart.getState().totals.total, items: cart.getState().totals.quantity });
}
