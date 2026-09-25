// Abstração de analytics: sem plataforma externa instalada.
// Eventos: view_product, select_size, add_to_cart, remove_from_cart, begin_checkout, whatsapp_checkout.
// Para integrar (GA4, Meta Pixel, Plausible…), basta ouvir 'gsl:analytics' ou definir window.dataLayer.
export function track(event, detail = {}) {
  const payload = { event, ...detail, timestamp: new Date().toISOString() };
  try {
    globalThis.dispatchEvent?.(new CustomEvent('gsl:analytics', { detail: payload }));
    if (Array.isArray(globalThis.dataLayer)) globalThis.dataLayer.push(payload);
  } catch { /* analytics nunca pode partir a loja */ }
}
