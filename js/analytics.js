// Analytics da loja.
//  • track(event, detail) emite 'gsl:analytics' (e window.dataLayer, se existir) — para integrar GA4, Meta Pixel, Plausible…
//    Eventos: page_view, view_product, select_size, add_to_cart, remove_from_cart, begin_checkout, whatsapp_checkout, whatsapp_click.
//  • Estatísticas próprias (painel /admin → Visitantes): com o Supabase configurado, os eventos de SERVER_EVENTS são
//    enviados em lote para track_events (supabase/analytics.sql). Anónimos: identificador aleatório do browser e da
//    visita, página, produto, origem (domínio) e tipo de dispositivo — sem nomes, telefones, IP nem cookies.
//    Não envia nada com Do Not Track / GPC, em browsers automatizados nem no browser de quem entra no /admin.
import { hasBackend, runtime } from './services/runtime.js';
import { MAX_BATCH, analyticsDevice, analyticsReferrer, nextSession, randomId, serverEvent, trackingAllowed } from './lib/analytics.js';

export const ANALYTICS_KEYS = Object.freeze({ visitor: 'gsl-visitor-v1', session: 'gsl-session-v1', optOut: 'gsl-no-track', off: 'gsl-analytics-off' });

const FLUSH_DELAY = 2000;
const URGENT = new Set(['whatsapp_checkout', 'whatsapp_click']); // a página pode sair para o WhatsApp a seguir
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const queue = [];
let timer = null;
let context = null;
let initialized = false;

function read(area, key) {
  try { return globalThis[area]?.getItem(key) ?? null; } catch { return null; }
}
function write(area, key, value) {
  try { globalThis[area]?.setItem(key, value); } catch { /* sem armazenamento (modo privado antigo) */ }
}

function getContext() {
  if (context) return context;
  const nav = globalThis.navigator ?? {};
  let enabled = hasBackend && typeof globalThis.fetch === 'function' && !read('sessionStorage', ANALYTICS_KEYS.off) && trackingAllowed({
    doNotTrack: nav.doNotTrack ?? globalThis.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
    webdriver: nav.webdriver,
    optedOut: read('localStorage', ANALYTICS_KEYS.optOut) === '1'
  });
  // Sem recolha (demo, Do Not Track, opção do admin…) não se guarda nenhum identificador no browser.
  if (!enabled) {
    context = { enabled: false, visitor: null, device: null };
    return context;
  }
  let visitor = read('localStorage', ANALYTICS_KEYS.visitor);
  if (!visitor || !UUID.test(visitor)) {
    visitor = randomId();
    write('localStorage', ANALYTICS_KEYS.visitor, visitor);
  }
  // Armazenamento bloqueado: cada página (e cada evento) contaria como visitante e visita novos → não conta.
  if (read('localStorage', ANALYTICS_KEYS.visitor) !== visitor) enabled = false;
  const screen = globalThis.screen ?? {};
  const device = analyticsDevice({ width: screen.width, height: screen.height, coarse: Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches) });
  context = { enabled, visitor, device };
  return context;
}

// A sessão é partilhada pelos separadores (localStorage) e renova-se com cada evento.
function sessionId() {
  let stored = null;
  try { stored = JSON.parse(read('localStorage', ANALYTICS_KEYS.session) ?? 'null'); } catch { /* valor corrompido */ }
  const next = nextSession(stored, Date.now());
  write('localStorage', ANALYTICS_KEYS.session, JSON.stringify({ id: next.id, last: next.last }));
  return next.id;
}

function stop() {
  write('sessionStorage', ANALYTICS_KEYS.off, '1');
  context = { ...getContext(), enabled: false };
  queue.length = 0;
}

function send(batch) {
  const key = runtime.supabaseAnonKey;
  try {
    fetch(`${runtime.supabaseUrl}/rest/v1/rpc/track_events`, {
      method: 'POST',
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_events: batch }),
      keepalive: true,
      credentials: 'omit'
    }).then(response => {
      // 404: supabase/analytics.sql ainda não foi executado → não voltar a tentar nesta visita.
      if (response.status === 404) stop();
    }).catch(() => { /* estatísticas nunca podem partir a loja */ });
  } catch { /* fetch substituído por outro script que lança logo (chamado também do temporizador e do pagehide) */ }
}

export function flushAnalytics() {
  clearTimeout(timer);
  timer = null;
  while (queue.length && getContext().enabled) send(queue.splice(0, MAX_BATCH));
}

function enqueue(event, detail) {
  const ctx = getContext();
  if (!ctx.enabled) return;
  const record = serverEvent(event, detail, { pathname: globalThis.location?.pathname ?? '/' });
  if (!record) return;
  queue.push({ ...record, visitor_id: ctx.visitor, session_id: sessionId(), device: ctx.device });
  if (URGENT.has(event) || queue.length >= MAX_BATCH) flushAnalytics();
  else if (!timer) timer = setTimeout(flushAnalytics, FLUSH_DELAY);
}

export function track(event, detail = {}) {
  const payload = { event, ...detail, timestamp: new Date().toISOString() };
  try {
    globalThis.dispatchEvent?.(new CustomEvent('gsl:analytics', { detail: payload }));
    if (Array.isArray(globalThis.dataLayer)) globalThis.dataLayer.push(payload);
    enqueue(event, detail);
  } catch { /* analytics nunca pode partir a loja */ }
}

// Uma vez por página (js/app.js): visita + cliques em links do WhatsApp + envio ao sair.
export function initAnalytics() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  try {
    track('page_view', { referrer: analyticsReferrer({ referrer: document.referrer, host: location.host, search: location.search }) });
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href*="wa.me/"], a[href*="api.whatsapp.com/"], a[href^="whatsapp:"]') : null;
      // No /finalizar o envio do pedido já conta como whatsapp_checkout.
      if (link && !link.closest('[data-checkout]')) track('whatsapp_click');
    }, { capture: true });
    addEventListener('pagehide', flushAnalytics);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAnalytics();
    });
  } catch { /* estatísticas nunca podem impedir o resto da loja de arrancar */ }
}
