// Finalizar pedido: 1 Dados → 2 Resumo → 3 WhatsApp.
// Antes de abrir o WhatsApp: revalida o catálogo (fresco), cria o pedido (Supabase ou local) e só depois navega.
import { track } from '../analytics.js';
import { cart, catalog } from '../app-context.js';
import { SITE_CONFIG, deliveryOption } from '../../config/site.js';
import { describeCartChange } from '../lib/cart.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { buildOrderDraft, orderTotals } from '../lib/order.js';
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
const NOTICE = {
  load: 'Atualizámos o teu pedido com o stock e os preços atuais:',
  send: 'Atualizámos o teu pedido antes de enviar:'
};

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
  let notice = { title: NOTICE.send, changes: [] };

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
    // O cabeçalho (com o botão Editar) só é criado uma vez: redesenhá-lo destruía o elemento que abriu
    // a gaveta e, ao fechá-la depois de alterar o pedido, o foco perdia-se.
    if (!$('[data-edit-cart]', aside)) {
      aside.innerHTML = `<div class="checkout__aside-head"><h2 id="checkout-aside-title"></h2><button type="button" class="text-button" data-edit-cart>Editar</button></div>
        <ul class="cart-lines" data-checkout-lines></ul>
        <div data-checkout-totals></div>`;
    }
    $('#checkout-aside-title', aside).textContent = `O teu pedido (${state.totals.quantity})`;
    $('[data-checkout-lines]', aside).innerHTML = state.items.map(line => cartLineHTML(line, { editable })).join('');
    renderAsideTotals();
  }

  // Totais com a taxa da forma de entrega escolhida — os mesmos do rascunho e da mensagem.
  function renderAsideTotals() {
    const totals = $('[data-checkout-totals]', aside);
    if (totals) totals.innerHTML = totalsHTML(orderTotals(cart.getItems(), customer.deliveryType));
  }

  function setNotice(changes = [], title = NOTICE.send) {
    notice = { title, changes };
  }

  function noticeHTML(extraClass = '') {
    if (!notice.changes.length) return '';
    return `<div class="review-notice${extraClass ? ` ${extraClass}` : ''}" role="alert"><strong>${notice.title}</strong><ul>${notice.changes.map(change => `<li>${escapeHTML(describeCartChange(change))}</li>`).join('')}</ul></div>`;
  }

  function renderEmpty() {
    grid.classList.add('is-single');
    aside.innerHTML = '';
    main.innerHTML = `<div class="checkout-empty">${noticeHTML()}${emptyOrderHTML({ heading: 'h2' })}</div>`;
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
        ${noticeHTML('field--full')}
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
    setNotice();
    renderReview();
    setStep('review');
    focusMain();
  });
  on(main, 'change', 'input[name="deliveryType"]', () => {
    syncLocationRequired();
    const form = $('[data-customer-form]', main);
    customer = { ...customer, ...formValues(form) };
    writeSession({ step, customer });
    renderAsideTotals();
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

  // Sem confirmação do servidor o pedido pode já estar gravado: em vez de repetir, falar com a loja.
  function unconfirmedHTML(failure, draft) {
    const text = [
      'Olá! 👋',
      `Tentei enviar um pedido pelo site da ${SITE_CONFIG.brandName} e não recebi confirmação.`,
      `Nome: ${draft.customer.name} · Telefone: ${draft.customer.phone}`,
      `Total: ${formatPrice(draft.total)}`,
      'Podem confirmar se ficou registado?'
    ].join('\n');
    return `${escapeHTML(friendlyOrderError(failure))} <a class="text-link" href="${escapeHTML(buildWhatsAppURL(runtime.whatsappNumber, text))}" target="_blank" rel="noopener">Falar connosco no WhatsApp</a>`;
  }

  async function send(button) {
    if (sending) return;
    sending = true;
    $('[data-send-error]', main).textContent = '';
    button.classList.add('is-loading');
    button.disabled = true;
    // Dados confirmados no resumo: enquanto se espera pelo servidor o cliente pode voltar ao formulário.
    const snapshot = { ...customer };
    // O botão sai do DOM quando o resumo deixa de estar à vista (Voltar, Editar dados, outro passo).
    const left = () => !button.isConnected;
    // No desktop abre-se já o separador (gesto do utilizador) para não ser bloqueado como pop-up;
    // no telemóvel navega-se no próprio separador para abrir a app do WhatsApp.
    const desktop = !isCoarsePointer();
    let popup = null;
    let draft = null;
    if (desktop) {
      try { popup = window.open('', '_blank'); } catch { popup = null; }
      if (popup) popup.document.write('<title>A abrir o WhatsApp…</title><p style="font:16px sans-serif;padding:24px">A preparar o teu pedido God Seven Line…</p>');
    }
    try {
      const { changes } = await catalog({ fresh: true });
      if (!cart.getItems().length) { popup?.close(); setNotice(changes); renderEmpty(); focusMain(); return; }
      // Saiu do resumo antes de o pedido ser criado: este envio fica sem efeito.
      if (left()) { popup?.close(); return; }
      if (changes.length) {
        popup?.close();
        setNotice(changes);
        renderReview();
        focusMain();
        return;
      }
      draft = buildOrderDraft(cart.getItems(), snapshot);
      const order = await submitOrder(draft);
      // A partir daqui o pedido está gravado: conclui mesmo que o cliente tenha saído do resumo entretanto.
      const message = buildOrderMessage(order, { demo: runtime.demo });
      const whatsappUrl = buildWhatsAppURL(runtime.whatsappNumber, message);
      const record = { ...order, message };
      saveLastOrder(record);
      track('whatsapp_checkout', { orderNumber: order.orderNumber, value: order.total, items: order.quantity, persistence: order.persistence });
      cart.clear();
      renderDone(record);
      setStep('done');
      focusMain();
      let opened = false;
      if (popup && !popup.closed) {
        try { popup.opener = null; popup.location.replace(whatsappUrl); opened = true; } catch { popup.close(); }
      }
      // Telemóvel, pop-up bloqueado ou separador fechado: abre no próprio separador (o pedido já está gravado).
      if (!opened) location.href = whatsappUrl;
    } catch (failure) {
      popup?.close();
      if (['STOCK_INSUFFICIENT', 'PRICE_CHANGED', 'PRODUCT_UNAVAILABLE'].includes(failure?.code)) {
        try { setNotice((await catalog({ fresh: true })).changes); } catch { /* mantém o aviso abaixo */ }
        if (!cart.getItems().length) { renderEmpty(); return; }
        if (left()) { toast(friendlyOrderError(failure), { tone: 'error' }); return; }
        renderReview();
        $('[data-send-error]', main).textContent = friendlyOrderError(failure);
        focusMain();
      } else if (left()) {
        toast(friendlyOrderError(failure), { tone: 'error' });
      } else if (failure?.code === 'ORDER_UNCONFIRMED') {
        $('[data-send-error]', main).innerHTML = unconfirmedHTML(failure, draft);
      } else {
        $('[data-send-error]', main).textContent = `${friendlyOrderError(failure)} Tenta novamente.`;
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
    // O link é sempre reconstruído a partir da mensagem (nunca um URL vindo do storage).
    const whatsappUrl = buildWhatsAppURL(runtime.whatsappNumber, String(order.message));
    grid.classList.add('is-single');
    aside.innerHTML = '';
    main.innerHTML = `<div class="checkout-success">
      <span class="checkout-success__mark" aria-hidden="true">${icon('check')}</span>
      <p class="eyebrow">PEDIDO #${escapeHTML(order.orderNumber)}</p>
      <h2 class="checkout__title">Pedido preparado.</h2>
      <p class="checkout__lead">Abrimos o WhatsApp com a mensagem pronta — só falta tocares em <strong>enviar</strong>. Total: <strong>${formatPrice(order.total)}</strong>.</p>
      <a class="button button--whatsapp" href="${escapeHTML(whatsappUrl)}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Abrir WhatsApp</span>${icon('arrow')}</a>
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
    if (target === 'done' && last?.orderNumber && typeof last.message === 'string' && !hasItems) { renderDone(last); setStep('done', { push: false }); return; }
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
    if (!state.items.length) {
      // Revalidações explicam-se com o aviso (definido por quem pediu o catálogo); remoções do cliente não.
      if (detail.reason !== 'reconcile') setNotice();
      renderEmpty();
      return;
    }
    // Voltou a haver peças (ex.: adicionadas noutro separador) enquanto se mostrava o pedido vazio.
    if ($('.checkout-empty', main)) { renderStep(step === 'review' ? 'review' : 'details'); return; }
    if (aside.innerHTML) renderAside();
  });

  try {
    // Peças removidas ou ajustadas ao abrir a página ficam explicadas no próprio passo, não só num toast.
    const { changes } = await catalog();
    setNotice(changes, NOTICE.load);
  } catch {
    main.innerHTML = `<div class="catalog-state" role="alert"><h2>Não foi possível carregar os produtos.</h2><p>Precisamos de confirmar preços e stock antes de finalizar.</p><button type="button" class="button" data-reload>Tentar novamente</button></div>`;
    $('[data-reload]', main).addEventListener('click', () => location.reload());
    return;
  }
  const initial = Object.entries(HASH).find(([, hash]) => hash === location.hash)?.[0] ?? session.step ?? 'details';
  renderStep(initial);
  if (cart.getItems().length) track('begin_checkout', { value: cart.getState().totals.total, items: cart.getState().totals.quantity });
}
