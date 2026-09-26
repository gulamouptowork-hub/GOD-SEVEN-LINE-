export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function on(root, event, selector, handler, options) {
  root.addEventListener(event, domEvent => {
    const target = domEvent.target instanceof Element ? domEvent.target.closest(selector) : null;
    if (target && root.contains(target)) handler(domEvent, target);
  }, options);
}

const dataSelector = element => {
  const attribute = Array.from(element.attributes).find(item => item.name.startsWith('data-') && item.value);
  return attribute ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : null;
};

// Controlos que o teclado alcança — nunca um link com tabindex="-1" ou escondido dos leitores de ecrã.
const isFocusable = element => !element.disabled && element.tabIndex >= 0 && !element.closest('[aria-hidden="true"], [hidden]');
const focusables = root => (root ? Array.from(root.querySelectorAll('a[href], button, input, select, textarea')).filter(isFocusable) : []);

// Re-render que devolve o foco ao elemento equivalente (mesmo seletor de dados) — evita perder o foco
// do teclado quando uma lista é redesenhada após um clique em +/−. Se esse elemento desapareceu ou ficou
// desativado, o foco vai para um controlo do mesmo grupo (ex.: o outro botão da linha), depois para a
// linha seguinte/anterior e, por fim, para o primeiro controlo do contentor (ex.: o estado vazio).
export function renderKeepingFocus(container, html) {
  const active = document.activeElement;
  const hadFocus = Boolean(active) && active !== container && container.contains(active);
  let selector = null;
  let group = null;
  let neighbours = [];
  if (hadFocus) {
    selector = dataSelector(active);
    for (let node = active.parentElement; node && node !== container; node = node.parentElement) {
      group = dataSelector(node);
      if (!group) continue;
      const siblings = Array.from(node.parentElement.children);
      const index = siblings.indexOf(node);
      neighbours = [...siblings.slice(index + 1), ...siblings.slice(0, index).reverse()].map(dataSelector).filter(Boolean);
      break;
    }
  }
  container.innerHTML = html;
  if (!hadFocus) return;
  const same = selector ? container.querySelector(selector) : null;
  if (same && isFocusable(same)) { same.focus({ preventScroll: true }); return; }
  const inGroup = group ? focusables(container.querySelector(group)) : [];
  const target = inGroup.find(element => element.localName === active.localName) ?? inGroup[0]
    ?? neighbours.map(item => focusables(container.querySelector(item))[0]).find(Boolean)
    ?? focusables(container)[0];
  target?.focus();
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isCoarsePointer = () => matchMedia('(pointer: coarse)').matches;
