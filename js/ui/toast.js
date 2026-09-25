import { escapeHTML } from '../lib/html.js';

export function toast(message, { tone = 'info', duration = 3200 } = {}) {
  const region = document.querySelector('[data-toast-region]');
  if (!region || !message) return;
  const element = document.createElement('div');
  element.className = `toast${tone === 'error' ? ' toast--error' : ''}`;
  element.innerHTML = escapeHTML(message);
  region.append(element);
  setTimeout(() => {
    element.classList.add('is-leaving');
    setTimeout(() => element.remove(), 300);
  }, duration);
}
