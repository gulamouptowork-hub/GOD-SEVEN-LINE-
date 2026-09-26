// Diálogos nativos (<dialog>): foco preso, Esc e inert gratuitos. Aqui só se trata de
// bloquear o scroll, fechar ao clicar no fundo e devolver o foco a quem abriu.
// Browsers sem <dialog> (Safari < 15.4, Firefox < 98): abre e fecha pelo atributo [open] (o CSS esconde
// os fechados) — sem foco preso, mas o pedido, o menu e a pesquisa continuam a funcionar.
import { $, $$, on } from './dom.js';

const NATIVE = typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';
const openers = new WeakMap();
// Diálogos abertos com openModal() — em vez de :modal, que Safari < 15.6 e Firefox < 103 não conhecem.
const modals = new WeakSet();

const isDialog = element => element instanceof Element && element.localName === 'dialog';
export const isOpen = dialog => Boolean(dialog?.hasAttribute('open'));

function syncScrollLock() {
  const anyModal = $$('dialog[open]').some(dialog => modals.has(dialog));
  document.documentElement.classList.toggle('is-locked', anyModal);
}

// Seletor de dados de quem abriu (ex.: [data-edit-cart]) — para o reencontrar se entretanto foi redesenhado.
function openerSelector(element) {
  const attribute = element instanceof Element ? Array.from(element.attributes).find(item => item.name.startsWith('data-')) : null;
  if (!attribute) return null;
  return attribute.value ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : `[${attribute.name}]`;
}

function restoreFocus({ element, selector }) {
  const visible = candidate => candidate.isConnected && candidate.getClientRects().length > 0;
  const target = (element && visible(element) ? element : null)
    ?? (selector ? $$(selector).find(visible) : null)
    ?? $('main');
  target?.focus({ preventScroll: true });
}

export function openModal(dialog, { focus } = {}) {
  if (!dialog) return;
  // O painel "Adicionado ao teu pedido" (não modal) fecha quando outro diálogo abre.
  const added = document.querySelector('[data-added-panel]');
  if (isOpen(added) && added !== dialog) closeModal(added);
  if (!isOpen(dialog)) {
    const active = document.activeElement;
    openers.set(dialog, { element: active, selector: openerSelector(active) });
    modals.add(dialog);
    if (NATIVE) dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  syncScrollLock();
  const target = typeof focus === 'string' ? dialog.querySelector(focus) : focus;
  (target ?? dialog.querySelector('[autofocus]'))?.focus({ preventScroll: true });
}

// Painel não modal (ex.: "Adicionado ao teu pedido").
export function showDialog(dialog) {
  if (!dialog || isOpen(dialog)) return;
  if (NATIVE) dialog.show();
  else dialog.setAttribute('open', '');
}

export function closeModal(dialog) {
  if (!isOpen(dialog)) return;
  if (NATIVE) { dialog.close(); return; }
  dialog.removeAttribute('open');
  dialog.dispatchEvent(new Event('close'));
}

export function setupDialogs() {
  on(document, 'click', '[data-dialog-close]', (event, button) => closeModal(button.closest('dialog')));
  document.addEventListener('close', event => {
    const dialog = event.target;
    // Um 'close' atrasado de um diálogo que entretanto voltou a abrir não conta.
    if (!isDialog(dialog) || isOpen(dialog)) return;
    modals.delete(dialog);
    syncScrollLock();
    const opener = openers.get(dialog);
    openers.delete(dialog);
    if (opener && !document.querySelector('dialog[open]')) restoreFocus(opener);
  }, true);
  // Clique no fundo (fora da caixa do diálogo) fecha.
  document.addEventListener('click', event => {
    const dialog = event.target;
    if (!isDialog(dialog) || !isOpen(dialog) || !modals.has(dialog)) return;
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) closeModal(dialog);
  });
  // Sem <dialog> nativo, o Esc também fecha o último diálogo aberto.
  if (!NATIVE) {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const last = $$('dialog[open]').filter(dialog => modals.has(dialog)).pop();
      if (last) closeModal(last);
    });
  }
}
