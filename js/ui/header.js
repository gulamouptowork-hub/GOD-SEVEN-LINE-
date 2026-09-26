import { $ } from './dom.js';
import { closeModal, openModal } from './dialogs.js';

export function setupHeader() {
  const header = $('[data-header]');
  const menu = $('[data-mobile-menu]');
  const menuButton = $('[data-menu-open]');

  if (header) {
    let ticking = false;
    const update = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 24);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  menuButton?.addEventListener('click', () => {
    openModal(menu, { focus: '[aria-current], nav a' });
    menuButton.setAttribute('aria-expanded', 'true');
  });
  menu?.addEventListener('close', () => menuButton?.setAttribute('aria-expanded', 'false'));
  // Ao passar para desktop com o menu aberto, fechá-lo.
  matchMedia('(min-width: 861px)').addEventListener('change', event => { if (event.matches) closeModal(menu); });
}
