export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function on(root, event, selector, handler, options) {
  root.addEventListener(event, domEvent => {
    const target = domEvent.target instanceof Element ? domEvent.target.closest(selector) : null;
    if (target && root.contains(target)) handler(domEvent, target);
  }, options);
}

// Re-render que devolve o foco ao elemento equivalente (mesmo seletor de dados) — evita perder o foco
// do teclado quando uma lista é redesenhada após um clique em +/−.
export function renderKeepingFocus(container, html) {
  const active = document.activeElement;
  let selector = null;
  if (active && container.contains(active)) {
    const attribute = Array.from(active.attributes).find(item => item.name.startsWith('data-') && item.value);
    if (attribute) selector = `[${attribute.name}="${CSS.escape(attribute.value)}"]`;
  }
  container.innerHTML = html;
  if (selector) {
    const next = container.querySelector(selector);
    if (next && !next.disabled) next.focus({ preventScroll: true });
    else container.querySelector('button:not([disabled]), a[href]')?.focus({ preventScroll: true });
  }
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isCoarsePointer = () => matchMedia('(pointer: coarse)').matches;
