// Regras puras das estatísticas anónimas (partilhadas pela loja e pelos testes).
// Espelham as validações de supabase/analytics.sql (track_events): o que não passa aqui também seria ignorado lá.

// Eventos que vão para o Supabase. Os restantes de track() (select_size, remove_from_cart…) ficam só no browser.
export const SERVER_EVENTS = Object.freeze(['page_view', 'view_product', 'add_to_cart', 'begin_checkout', 'whatsapp_checkout', 'whatsapp_click']);

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_BATCH = 25;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE = /^[a-z0-9._-]+$/;

// Caminho sem query string (pode ter dados de pesquisa), sem barra final nem ".html".
export function analyticsPath(pathname) {
  let path = String(pathname ?? '').split(/[?#]/)[0].trim();
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/index(?:\.html)?$/i, '/').replace(/\.html$/i, '').replace(/\/+$/, '') || '/';
  return path.length <= 200 ? path : path.slice(0, 200);
}

export function productSlugFromPath(pathname) {
  const match = /^\/produtos\/([^/]+)$/.exec(analyticsPath(pathname));
  if (!match) return null;
  let slug;
  try { slug = decodeURIComponent(match[1]).toLowerCase(); } catch { return null; }
  return slug.length <= 120 && SLUG.test(slug) ? slug : null;
}

export function validSlug(value) {
  const slug = String(value ?? '').toLowerCase();
  return slug && slug.length <= 120 && SLUG.test(slug) ? slug : null;
}

// Domínios de redes/buscadores normalizados para o mesmo nome (l.instagram.com → instagram.com).
const HOST_PREFIXES = /^(?:www\d?|m|l|lm|mobile|web)\./;

export function normalizeSourceHost(host) {
  const clean = String(host ?? '').toLowerCase().replace(/\.$/, '').replace(HOST_PREFIXES, '');
  return clean && clean.length <= 100 && SOURCE.test(clean) ? clean : null;
}

// Origem da visita: utm_source (links da bio do Instagram, campanhas) ou o domínio do referrer externo.
// Navegação interna (mesmo domínio) → null.
export function analyticsReferrer({ referrer = '', host = '', search = '' } = {}) {
  try {
    const utm = new URLSearchParams(search).get('utm_source');
    if (utm) {
      const source = utm.trim().toLowerCase().replace(/\s+/g, '-');
      if (source.length <= 100 && SOURCE.test(source)) return source;
    }
  } catch { /* query inválida */ }
  if (!referrer) return null;
  let url;
  try { url = new URL(referrer); } catch { return null; }
  const referrerHost = url.hostname.toLowerCase();
  const ownHost = String(host).toLowerCase().split(':')[0];
  if (!referrerHost || referrerHost === ownHost || normalizeSourceHost(referrerHost) === normalizeSourceHost(ownHost)) return null;
  return normalizeSourceHost(referrerHost);
}

// Tipo de dispositivo pelo tamanho do ecrã (não pelo user-agent, que não é guardado).
export function analyticsDevice({ width = 0, height = 0, coarse = false } = {}) {
  const shortSide = Math.min(width || 0, height || 0) || width || 0;
  if (coarse && shortSide && shortSide < 600) return 'mobile';
  if (coarse && shortSide && shortSide < 1100) return 'tablet';
  if (!coarse && width && width < 600) return 'mobile';
  return 'desktop';
}

// Identificador aleatório (UUID v4) — crypto.randomUUID ou, em browsers antigos, getRandomValues.
export function randomId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Sessão = visita: a mesma enquanto houver atividade há menos de 30 minutos.
export function nextSession(stored, now, makeId = randomId) {
  if (stored && typeof stored.id === 'string' && Number.isFinite(stored.last) && now - stored.last < SESSION_TIMEOUT_MS && now >= stored.last) {
    return { id: stored.id, last: now, isNew: false };
  }
  return { id: makeId(), last: now, isNew: true };
}

// Converte um evento de track() no registo enviado ao servidor (ou null se não for para enviar).
export function serverEvent(event, detail = {}, { pathname = '/' } = {}) {
  if (!SERVER_EVENTS.includes(event)) return null;
  const path = analyticsPath(pathname);
  const record = { event, path };
  const slug = validSlug(detail.slug) ?? (['view_product', 'add_to_cart', 'whatsapp_click'].includes(event) ? productSlugFromPath(path) : null);
  if (slug) record.product_slug = slug;
  const referrer = event === 'page_view' ? normalizeSourceHost(detail.referrer) : null;
  if (referrer) record.referrer = referrer;
  return record;
}

// Quem não quer ser contado: Do Not Track / Global Privacy Control, browsers automatizados
// e o browser de quem entra no painel /admin (marca 'gsl-no-track').
export function trackingAllowed({ doNotTrack, globalPrivacyControl, webdriver, optedOut } = {}) {
  if (optedOut) return false;
  if (webdriver) return false;
  if (globalPrivacyControl === true) return false;
  return !['1', 'yes'].includes(String(doNotTrack ?? ''));
}
