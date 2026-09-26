import { $$ } from './ui/dom.js';
import { closeModal, openModal } from './ui/dialogs.js';

let installPrompt = null;

const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isiOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function showInstallButtons(show) {
  $$('[data-install-app]').forEach(button => { button.hidden = !show; });
}

export function initPWA() {
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(error => {
      console.warn('[God Seven Line] A aplicação offline não pôde ser ativada.', error);
    }), { once: true });
  }

  if (installed()) return;
  const dialog = document.querySelector('[data-install-dialog]');
  const ios = isiOS();
  if (ios) showInstallButtons(true);

  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    showInstallButtons(true);
  });

  $$('[data-install-app]').forEach(button => button.addEventListener('click', async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      await prompt.userChoice;
      showInstallButtons(false);
      return;
    }
    if (ios && dialog) openModal(dialog, { focus: '[data-dialog-close]' });
  }));

  addEventListener('appinstalled', () => {
    installPrompt = null;
    showInstallButtons(false);
    closeModal(dialog);
  });
}
