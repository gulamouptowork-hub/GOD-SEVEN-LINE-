// Diálogos nativos (<dialog>): foco preso, Esc e inert gratuitos. Aqui só se trata de
// bloquear o scroll, fechar ao clicar no fundo e devolver o foco a quem abriu.
import { $$, on } from './dom.js';

const openers = new WeakMap();

function syncScrollLock() {
  const anyModal = $$('dialog[open]').some(dialog => dialog.matches(':modal'));
  document.documentElement.classList.toggle('is-locked', anyModal);
}

export function openModal(dialog, { focus } = {}) {
  if (!dialog) return;
  // O painel "Adicionado ao teu pedido" (não modal) fecha quando outro diálogo abre.
  const added = document.querySelector('[data-added-panel]');
  if (added?.open && added !== dialog) added.close();
  if (!dialog.open) {
    openers.set(dialog, document.activeElement);
    dialog.showModal();
  }
  syncScrollLock();
  const target = typeof focus === 'string' ? dialog.querySelector(focus) : focus;
  (target ?? dialog.querySelector('[autofocus]'))?.focus({ preventScroll: true });
}

export function closeModal(dialog) {
  if (dialog?.open) dialog.close();
}

export function setupDialogs() {
  on(document, 'click', '[data-dialog-close]', (event, button) => closeModal(button.closest('dialog')));
  document.addEventListener('close', event => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    syncScrollLock();
    const opener = openers.get(dialog);
    openers.delete(dialog);
    if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus({ preventScroll: true });
  }, true);
  // Clique no fundo (fora da caixa do diálogo) fecha.
  document.addEventListener('click', event => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open || !dialog.matches(':modal')) return;
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) closeModal(dialog);
  });
}
