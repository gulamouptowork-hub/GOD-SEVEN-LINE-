import { prefersReducedMotion } from './dom.js';

export function setupReveal(root = document) {
  const elements = root.querySelectorAll('.reveal:not(.revealed)');
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    elements.forEach(element => element.classList.add('revealed'));
    return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('revealed');
    observer.unobserve(entry.target);
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  elements.forEach(element => observer.observe(element));
}
