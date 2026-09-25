// Estrutura comum das páginas públicas (header, menus, gaveta do pedido, pesquisa, footer).
import { SITE_CONFIG } from '../../config/site.js';
import { escapeHTML } from '../../js/lib/html.js';
import { absoluteImageURL } from '../../js/lib/images.js';
import { icon } from '../../js/ui/templates.js';

const NAV = [
  { href: '/', label: 'Início', page: 'home' },
  { href: '/produtos', label: 'Coleção', page: 'catalog' },
  { href: '/servicos', label: 'Personalização', page: 'services' },
  { href: '/sobre', label: 'Sobre', page: 'story' }
];
const SECONDARY_NAV = [
  { href: '/Localizacao', label: 'Localização' },
  { href: '/contactos', label: 'Contactos' }
];

const current = (item, page) => (item.page === page || (page === 'product' && item.page === 'catalog') ? ' aria-current="page"' : '');

function header(page) {
  return `<header class="site-header" data-header>
  <div class="site-header__inner">
    <button class="icon-button menu-button" type="button" data-menu-open aria-controls="mobile-menu" aria-expanded="false">
      <span class="menu-button__bars" aria-hidden="true"><span></span><span></span></span><span class="sr-only">Abrir menu</span>
    </button>
    <a class="wordmark" href="/" aria-label="God Seven Line — Início">GOD SEVEN<span>LINE®</span></a>
    <nav class="site-nav" aria-label="Navegação principal">${NAV.map(item => `<a href="${item.href}"${current(item, page)}>${item.label}</a>`).join('')}</nav>
    <div class="header-actions">
      <button class="header-action header-action--search" type="button" data-search-open aria-haspopup="dialog">${icon('search')}<span class="header-action__label">Pesquisa</span></button>
      <button class="header-action header-action--order" type="button" data-cart-open aria-haspopup="dialog" aria-label="Abrir o teu pedido, 0 peças" data-cart-button>
        <span class="header-action__label">Pedido</span><span class="order-count">(<span data-cart-count>0</span>)</span>
      </button>
    </div>
  </div>
</header>`;
}

function mobileMenu(page) {
  return `<dialog class="mobile-menu" id="mobile-menu" data-mobile-menu aria-label="Menu">
  <div class="mobile-menu__top">
    <a class="wordmark wordmark--light" href="/">GOD SEVEN<span>LINE®</span></a>
    <button class="icon-button" type="button" data-dialog-close aria-label="Fechar menu">${icon('close')}</button>
  </div>
  <nav class="mobile-menu__nav" aria-label="Menu">${NAV.map((item, index) => `<a href="${item.href}"${current(item, page)}><small>0${index + 1}</small>${item.label}</a>`).join('')}</nav>
  <div class="mobile-menu__footer">
    <nav aria-label="Mais">${SECONDARY_NAV.map(item => `<a href="${item.href}">${item.label}</a>`).join('')}<a href="${SITE_CONFIG.social.instagram.url}" target="_blank" rel="noopener">Instagram ↗</a></nav>
    <p>Não seguimos tendências. Criamos.</p>
  </div>
</dialog>`;
}

function cartDrawer() {
  return `<dialog class="drawer cart-drawer" data-cart-drawer aria-labelledby="cart-drawer-title">
  <div class="drawer__head">
    <h2 id="cart-drawer-title">O teu pedido <span data-cart-title-count></span></h2>
    <button class="icon-button" type="button" data-dialog-close aria-label="Fechar o teu pedido">${icon('close')}</button>
  </div>
  <div class="drawer__notice" data-cart-notice role="status" hidden></div>
  <div class="drawer__body" data-cart-body><p class="drawer__loading">A carregar o teu pedido…</p></div>
  <div class="drawer__foot" data-cart-foot hidden></div>
</dialog>
<dialog class="added-panel" data-added-panel aria-labelledby="added-title"></dialog>`;
}

function searchDialog() {
  return `<dialog class="search-dialog" data-search-dialog aria-labelledby="search-title">
  <div class="search-dialog__inner">
    <div class="search-dialog__head">
      <h2 id="search-title" class="eyebrow">Pesquisa / Coleção</h2>
      <button class="icon-button" type="button" data-dialog-close aria-label="Fechar pesquisa">${icon('close')}</button>
    </div>
    <form class="search-dialog__form" action="/produtos" role="search" data-search-form>
      <label class="sr-only" for="global-search">Pesquisar peças</label>
      ${icon('search')}
      <input id="global-search" name="q" type="search" placeholder="Procura uma peça…" autocomplete="off" data-search-input>
    </form>
    <div class="search-dialog__results" data-search-results aria-live="polite"></div>
  </div>
</dialog>`;
}

function footer({ communityBand = true } = {}) {
  const instagram = SITE_CONFIG.social.instagram;
  const band = communityBand ? `<section class="community">
  <div><p class="eyebrow">FAZ PARTE DA NOSSA HISTÓRIA</p><h2>A tua gente. A tua linha.</h2></div>
  <a class="button light" href="${instagram.url}" target="_blank" rel="noopener">Segue no Instagram <span>↗</span></a>
</section>` : '';
  return `${band}
<footer class="site-footer">
  <div class="footer-top">
    <a class="wordmark" href="/">GOD SEVEN<span>LINE®</span></a>
    <p>Não seguimos tendências. Criamos.<br>De Moçambique, com propósito.</p>
    <nav aria-label="Rodapé"><a href="/produtos">Coleção</a><a href="/servicos">Personalização</a><a href="/sobre">A nossa história</a><a href="/contactos">Contactos</a><a href="/Localizacao">Localização</a><a href="${instagram.url}" target="_blank" rel="noopener">Instagram ↗</a></nav>
  </div>
  <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${SITE_CONFIG.brandName}</span><span>Cada linha conta uma história.</span><a href="#top">Voltar ao topo ↑</a></div>
</footer>`;
}

export function layout({
  page, title, description, body, path = '/', image = 'polos-rosa-vermelho', ogType = 'website',
  head = '', communityBand = true, noindex = false, demo = false, fullTitle = false, preload = ['/js/app.js']
}) {
  const siteUrl = SITE_CONFIG.siteUrl;
  const pageTitle = fullTitle ? title : `${title} — ${SITE_CONFIG.brandName}`;
  const desc = description || 'God Seven Line. Streetwear e personalização com identidade moçambicana. Monta o teu pedido e envia-o pelo WhatsApp.';
  const canonical = `${siteUrl}${path === '/' ? '/' : path}`;
  const ogImage = absoluteImageURL(image, siteUrl);
  return `<!DOCTYPE html>
<html lang="pt-MZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHTML(pageTitle)}</title>
<meta name="description" content="${escapeHTML(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escapeHTML(canonical)}">`}
<meta name="theme-color" content="#f5f3ed">
<meta property="og:site_name" content="${SITE_CONFIG.brandName}">
<meta property="og:locale" content="pt_PT">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeHTML(pageTitle)}">
<meta property="og:description" content="${escapeHTML(desc)}">
<meta property="og:url" content="${escapeHTML(canonical)}">
<meta property="og:image" content="${escapeHTML(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icons/icon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/assets/icons/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&amp;family=DM+Sans:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/styles/god-seven.css">
<link rel="stylesheet" href="/styles/store.css">
${preload.map(href => `<link rel="modulepreload" href="${href}">`).join('\n')}
<script type="module" src="/js/app.js"></script>
${head}
</head>
<body id="top" data-page="${page}">
<a class="skip" href="#main">Saltar para o conteúdo</a>
${demo ? '<div class="demo-banner" role="note"><strong>MODO DEMONSTRAÇÃO</strong> Preços e stock fictícios — não publicar.</div>' : ''}
<div class="announcement">NASCIDA EM MOÇAMBIQUE. CRIADA PARA TE EXPRESSARES. <span>EST. 2025</span></div>
${header(page)}
<main id="main" tabindex="-1">
${body}
</main>
${footer({ communityBand })}
${mobileMenu(page)}
${cartDrawer()}
${searchDialog()}
<div class="toast-region" data-toast-region aria-live="polite" aria-atomic="true"></div>
</body>
</html>
`;
}
