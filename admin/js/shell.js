// Estrutura do painel (barra lateral, cabeçalho, mensagens) e router por hash.
import { escapeHTML } from '/js/lib/html.js';
import { parseRoute } from './logic.js';
import { renderDashboard } from './dashboard.js';
import { renderProducts } from './products.js';
import { renderProductEditor } from './product-editor.js';
import { renderStock } from './stock.js';
import { renderOrderDetail, renderOrders } from './orders.js';
import { emptyHTML } from './ui.js';
import { renderVisitors } from './visitors.js';

const NAV = [
  { section: 'dashboard', href: '#/', label: 'Dashboard' },
  { section: 'visitantes', href: '#/visitantes', label: 'Visitantes' },
  { section: 'produtos', href: '#/produtos', label: 'Produtos' },
  { section: 'pedidos', href: '#/pedidos', label: 'Pedidos' },
  { section: 'stock', href: '#/stock', label: 'Stock' }
];

const UNSAVED_MESSAGE = 'Tens alterações por guardar. Sair desta página sem guardar?';

// Cada entrada do histórico mostrada pelo painel fica com um carimbo crescente (history.state.t). Assim, ao
// "Cancelar" a confirmação de saída, sabe-se se o utilizador recuou ou avançou e repõe-se a entrada certa.
let lastStamp = 0;

function renderNotFound(ctx) {
  ctx.setTitle('Página não encontrada');
  ctx.main.innerHTML = `<div class="page-head"><h1 tabindex="-1">Página não encontrada</h1></div>
    ${emptyHTML('Este endereço não existe no painel.', '<p><a class="btn" href="#/">Ir para o Dashboard</a></p>')}`;
}

const VIEWS = {
  dashboard: renderDashboard,
  products: renderProducts,
  'product-new': renderProductEditor,
  'product-edit': renderProductEditor,
  stock: renderStock,
  orders: renderOrders,
  'order-detail': renderOrderDetail,
  visitors: renderVisitors,
  'not-found': renderNotFound
};

function shellHTML(email) {
  return `
  <a class="skip-link" href="#main" data-skip>Saltar para o conteúdo</a>
  <div class="shell">
    <aside class="sidebar" data-sidebar>
      <div class="sidebar-top">
        <p class="brand"><span class="brand-kicker">PAINEL ADMIN</span><span class="brand-name">GOD SEVEN LINE</span></p>
        <button type="button" class="menu-toggle" aria-expanded="false" aria-controls="admin-nav" data-menu-toggle>Menu</button>
      </div>
      <nav id="admin-nav" class="nav" aria-label="Painel">
        <ul>${NAV.map(item => `<li><a href="${item.href}" data-section="${item.section}">${item.label}</a></li>`).join('')}</ul>
        <button type="button" class="nav-logout" data-logout>Sair</button>
      </nav>
    </aside>
    <div class="content">
      <header class="content-header">
        <p class="session">Sessão: <strong>${escapeHTML(email)}</strong></p>
        <a class="store-link" href="/" target="_blank" rel="noopener">Ver loja<span class="sr-only"> (abre noutro separador)</span> ↗</a>
      </header>
      <div class="flash-region">
        <div class="flash" role="status" data-flash-status></div>
        <div class="flash flash-error" role="alert" data-flash-alert></div>
      </div>
      <main id="main" class="main" tabindex="-1"></main>
    </div>
  </div>`;
}

// Monta o painel autenticado. Devolve { destroy, flash }.
export function mountShell(root, { api, email, onLogout, supabaseUrl = '' }) {
  root.innerHTML = shellHTML(email);
  const main = root.querySelector('#main');
  const sidebar = root.querySelector('[data-sidebar]');
  const toggle = root.querySelector('[data-menu-toggle]');
  const flashStatus = root.querySelector('[data-flash-status]');
  const flashAlert = root.querySelector('[data-flash-alert]');

  let token = 0;
  let guard = null;
  let cleanup = null;
  let currentHash = location.hash || '#/';
  let currentStamp = 0;
  let carryFlash = null;
  let firstRender = true;

  const isDirty = () => Boolean(guard?.());

  function flash(message, type = 'success') {
    flashStatus.textContent = '';
    flashAlert.textContent = '';
    flashStatus.className = `flash flash-${type === 'info' ? 'info' : 'success'}`;
    if (!message) return;
    if (type === 'error') flashAlert.textContent = message;
    else flashStatus.textContent = message;
  }

  function setMenu(open) {
    sidebar.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  function stampEntry() {
    const stamp = history.state?.t;
    if (Number.isFinite(stamp)) {
      currentStamp = stamp;
      return;
    }
    currentStamp = lastStamp = Math.max(Date.now(), lastStamp + 1);
    history.replaceState({ ...history.state, t: currentStamp }, '');
  }

  function updateNav(section) {
    for (const link of root.querySelectorAll('.nav a[data-section]')) {
      if (link.dataset.section === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  function render() {
    token += 1;
    const mine = token;
    try { cleanup?.(); } catch (error) { console.error(error); }
    cleanup = null;
    guard = null;
    currentHash = location.hash || '#/';
    stampEntry();
    const route = parseRoute(currentHash);
    updateNav(route.section);
    setMenu(false);
    flash('');
    if (carryFlash) {
      flash(...carryFlash);
      carryFlash = null;
    }
    main.innerHTML = '';
    const ctx = {
      api,
      main,
      route,
      supabaseUrl,
      alive: () => mine === token,
      setTitle: title => { document.title = `${title} · Painel Admin · God Seven Line`; },
      flash,
      setGuard: fn => { if (mine === token) guard = fn; },
      // Navega; a mensagem opcional aparece depois de a nova vista ser mostrada.
      navigate: (hash, message = null) => {
        carryFlash = message;
        if (location.hash === hash) render();
        else location.hash = hash;
      },
      // Troca o endereço sem voltar a desenhar a vista (ex.: produto novo acabou de ser criado).
      replaceRoute: hash => {
        history.replaceState(history.state, '', hash);
        currentHash = hash;
      }
    };
    try {
      const result = VIEWS[route.name](ctx);
      Promise.resolve(result).then(fn => {
        if (typeof fn !== 'function') return;
        if (mine === token) cleanup = fn;
        else fn();
      }).catch(error => console.error(error));
    } catch (error) {
      console.error(error);
      main.innerHTML = emptyHTML('Ocorreu um erro inesperado ao mostrar esta página.');
    }
    if (!firstRender) main.querySelector('h1')?.focus();
    firstRender = false;
  }

  function onHashChange() {
    const next = location.hash || '#/';
    if (next === currentHash) return;
    if (isDirty() && !window.confirm(UNSAVED_MESSAGE)) {
      // Recuou (entrada mais antiga) → avançar de novo. Avançou, ou entrada nova (link, endereço escrito) → recuar.
      // Não se reescreve nenhuma entrada; o hashchange seguinte volta a currentHash e é ignorado acima.
      if (history.state?.t < currentStamp) history.forward();
      else history.back();
      return;
    }
    render();
  }

  function onBeforeUnload(event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      setMenu(false);
      toggle.focus();
    }
  }

  toggle.addEventListener('click', () => setMenu(!sidebar.classList.contains('is-open')));
  root.querySelector('[data-skip]').addEventListener('click', event => {
    event.preventDefault();
    main.focus();
  });
  root.querySelector('[data-logout]').addEventListener('click', async event => {
    if (isDirty() && !window.confirm(UNSAVED_MESSAGE)) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await onLogout();
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('keydown', onKeydown);

  render();

  return {
    flash,
    destroy() {
      token += 1;
      try { cleanup?.(); } catch (error) { console.error(error); }
      guard = null;
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('keydown', onKeydown);
      root.innerHTML = '';
    }
  };
}
