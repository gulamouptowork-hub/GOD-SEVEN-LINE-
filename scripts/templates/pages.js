// Conteúdo das páginas públicas. O texto editorial vem do site original — preservar a voz da marca.
import { SITE_CONFIG, categoryLabel } from '../../config/site.js';
import {
  PRICE_ON_REQUEST, SORT_OPTIONS, productAvailability, productPriceRange, productURL, variantPrice, variantStatus
} from '../../js/lib/catalog.js';
import { escapeHTML } from '../../js/lib/html.js';
import { absoluteImageURL, imgHTML } from '../../js/lib/images.js';
import { buildInquiryMessage, buildWhatsAppURL } from '../../js/lib/whatsapp.js';
import { categoriesForFilter, icon, productGridHTML } from '../../js/ui/templates.js';
import {
  galleryHTML, howtoStepsHTML, initialSelection, inquiryDetails, productHeaderHTML, purchaseHTML
} from '../../js/ui/product-templates.js';

const jsonLD = data => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const ticker = `<div class="ticker" aria-label="Identidade da marca"><div class="ticker-track"><span>CADA LINHA CONTA UMA HISTÓRIA</span><b aria-hidden="true">✳</b><span>FEITO PARA SERES TU</span><b aria-hidden="true">✳</b><span>GOD SEVEN LINE</span><b aria-hidden="true">✳</b><span aria-hidden="true">CADA LINHA CONTA UMA HISTÓRIA</span><b aria-hidden="true">✳</b><span aria-hidden="true">FEITO PARA SERES TU</span><b aria-hidden="true">✳</b><span aria-hidden="true">GOD SEVEN LINE</span><b aria-hidden="true">✳</b></div></div>`;

// ---------------------------------------------------------------- Homepage

export function homePage({ products, now }) {
  const featured = products.filter(product => product.featured).slice(0, 4);
  const counts = Object.fromEntries(SITE_CONFIG.categories.map(category => [category.id, products.filter(product => product.category === category.id).length]));
  const categories = SITE_CONFIG.categories.filter(category => category.image && counts[category.id] > 0);
  const instagram = SITE_CONFIG.social.instagram;
  const community = SITE_CONFIG.community;

  const body = `<section class="hero">
  <div class="hero-copy enter">
    <p class="eyebrow"><span class="dot"></span> INDEPENDENTE. MOÇAMBICANA. ORIGINAL.</p>
    <h1>VESTE A<br>TUA <em>HISTÓRIA.</em></h1>
    <p class="hero-description">Mais do que roupa. Uma forma de seres tu.<br>Peças com atitude, criadas para a tua próxima história.</p>
    <div class="hero-actions"><a class="button" href="/produtos">Ver coleção <span>↗</span></a><a class="text-link" href="/sobre">Descobrir a marca</a></div>
    <div class="hero-bottom"><span>ESTILO SEM REGRAS.<br>IDENTIDADE SEM LIMITES.</span><a href="#new-drop" aria-label="Ver os destaques">↓</a></div>
  </div>
  <div class="hero-photo">${imgHTML('polos-rosa-vermelho', { alt: 'Duas jovens com polos God Seven Line rosa e vermelho', sizes: '(min-width: 641px) 50vw, 100vw', loading: 'eager', fetchpriority: 'high' })}<span class="photo-caption">THE SEVEN WAY OF LIFE.</span><div class="photo-label"><span>GOD SEVEN LINE</span><span>MOZAMBIQUE ↗</span></div></div>
</section>
${ticker}
<section class="collection section" id="new-drop" aria-labelledby="new-drop-title">
  <div class="section-heading"><div><p class="eyebrow">NEW DROP / DESTAQUES</p><h2 id="new-drop-title">O teu próximo favorito.</h2></div><a class="text-link" href="/produtos">Ver toda a coleção ↗</a></div>
  <div class="product-grid product-grid--featured" data-featured-grid>${productGridHTML(featured, { now })}</div>
</section>
<section class="brand-story" aria-labelledby="manifesto-title">
  <div class="story-photo">${imgHTML('tee-verde-modelo', { alt: 'T-shirt verde Seven usada ao ar livre em Moçambique', sizes: '(min-width: 641px) 50vw, 100vw' })}<span>07 / LINHAS COM PROPÓSITO</span></div>
  <div class="story-copy reveal"><p class="eyebrow">MANIFESTO / RAÍZES LOCAIS</p><h2 id="manifesto-title">Não seguimos<br>tendências.<br><em>Criamos.</em></h2><p>Nascemos em Moçambique para quem quer vestir mais do que roupa. Cada peça carrega uma história, uma identidade e um propósito. Agora, faz parte da tua.</p><a class="text-link" href="/sobre">Conhece a nossa história ↗</a></div>
</section>
<section class="category-section section" aria-labelledby="categories-title">
  <div class="section-heading"><div><p class="eyebrow">SHOP BY CATEGORY</p><h2 id="categories-title">Encontra a tua linha.</h2></div></div>
  <div class="category-grid category-grid--${categories.length}">${categories.map(category => `
    <a class="category-tile reveal" href="/produtos?categoria=${category.id}">
      ${imgHTML(category.image, { alt: '', sizes: '(min-width: 900px) 25vw, 50vw' })}
      <span class="category-tile__label">${escapeHTML(category.label.toUpperCase())} <span aria-hidden="true">↗</span></span>
      <span class="category-tile__count">${counts[category.id]} ${counts[category.id] === 1 ? 'peça' : 'peças'}</span>
    </a>`).join('')}
  </div>
</section>
<section class="custom section"><p class="eyebrow">A TUA IDEIA. A NOSSA ESTAMPA.</p><h2>Única. Como tu.</h2><p>Uma t-shirt, uma sacola ou uma ideia fora da caixa.<br>Dá vida à tua criatividade com a nossa personalização.</p><a class="button" href="/servicos">Criar a minha peça <span>↗</span></a><span class="custom-art" aria-hidden="true">✳</span></section>
<section class="street-section" aria-labelledby="community-title">
  <div class="street-heading"><div><p class="eyebrow">SEVEN COMMUNITY / VISTO NAS RUAS</p><h2 id="community-title">De Moçambique<br>para o mundo.</h2></div><a class="text-link text-link--light" href="${instagram.url}" target="_blank" rel="noopener">Segue ${escapeHTML(instagram.handle)} ↗</a></div>
  <ul class="street-grid street-grid--${community.length}" role="list">${community.map((item, index) => `
    <li class="street-grid__item reveal">${imgHTML(item.image, { alt: item.alt, sizes: index === 0 ? '(min-width: 900px) 40vw, 100vw' : '(min-width: 900px) 20vw, 50vw' })}</li>`).join('')}
  </ul>
</section>
<section class="final-cta"><p class="eyebrow">A PRÓXIMA LINHA É TUA</p><h2>VESTE A TUA HISTÓRIA.</h2><a class="button" href="/produtos">Explorar coleção <span>→</span></a></section>`;

  const organization = jsonLD({
    '@context': 'https://schema.org', '@type': 'Organization', name: SITE_CONFIG.brandName, url: `${SITE_CONFIG.siteUrl}/`,
    logo: `${SITE_CONFIG.siteUrl}/assets/icons/icon-512.png`, sameAs: [instagram.url]
  });
  return { body, head: organization, communityBand: false };
}

// ---------------------------------------------------------------- Coleção

export function catalogPage({ products, now }) {
  const option = (value, label) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;
  const body = `<section class="catalog-page section" data-catalog>
  <header class="catalog-hero">
    <p class="eyebrow">COLEÇÃO / GOD SEVEN LINE</p>
    <h1>Coleção.</h1>
    <p>A tua próxima linha. Peças que contam histórias, feitas para quem vive sem regras.</p>
  </header>
  <div class="catalog-toolbar">
    <div class="category-tabs" role="group" aria-label="Filtrar por categoria">${categoriesForFilter().map(category => `
      <button type="button" class="chip" data-category="${category.id}" aria-pressed="${category.id === ''}">${escapeHTML(category.label)}</button>`).join('')}
    </div>
    <div class="catalog-controls">
      <label class="control control--search"><span class="sr-only">Pesquisar peças</span>${icon('search')}<input type="search" data-filter="q" placeholder="Pesquisar peças…" autocomplete="off"></label>
      <button type="button" class="control control--filters" data-filters-open aria-haspopup="dialog">Filtros <span class="filter-count" data-filter-count hidden></span></button>
      <div class="filters-slot" data-filters-slot>
        <div class="filters-panel" data-filters-panel>
          <label class="control"><span class="control__label">Tamanho</span><select data-filter="size">${option('', 'Todos')}${SITE_CONFIG.sizes.map(size => option(size, size)).join('')}</select></label>
          <label class="control"><span class="control__label">Disponibilidade</span><select data-filter="availability">${option('', 'Todas')}${option('available', 'Em stock')}${option('soldout', 'Esgotado')}</select></label>
          <label class="control"><span class="control__label">Faixa de preço</span><select data-filter="price">${option('', 'Todas')}${SITE_CONFIG.priceRanges.map(range => option(range.id, range.label)).join('')}</select></label>
        </div>
      </div>
      <label class="control"><span class="control__label">Ordenar por</span><select data-sort>${SORT_OPTIONS.map(sort => option(sort.id, sort.label)).join('')}</select></label>
    </div>
  </div>
  <div class="catalog-meta"><p data-result-count aria-live="polite">${products.length} ${products.length === 1 ? 'peça' : 'peças'}</p><button type="button" class="text-button" data-clear-filters hidden>Limpar filtros</button></div>
  <div class="product-grid catalog-grid" data-catalog-grid>${productGridHTML(products, { now, eager: true, heading: 'h2' })}</div>
  <div class="catalog-state" data-catalog-empty hidden><span class="catalog-state__mark" aria-hidden="true">7</span><h2>Nenhuma peça encontrada.</h2><p>Experimenta remover um filtro ou procurar outro nome.</p><button type="button" class="button" data-clear-filters>Limpar filtros</button></div>
  <div class="catalog-state" data-catalog-error hidden role="alert"><h2>Não foi possível carregar os produtos.</h2><p>Verifica a tua ligação e tenta novamente.</p><button type="button" class="button" data-retry>Tentar novamente</button></div>
</section>
<dialog class="drawer filters-drawer" data-filters-dialog aria-labelledby="filters-title">
  <div class="drawer__head"><h2 id="filters-title">Filtros</h2><button class="icon-button" type="button" data-dialog-close aria-label="Fechar filtros">${icon('close')}</button></div>
  <div class="drawer__body" data-filters-dialog-slot></div>
  <div class="drawer__foot"><button type="button" class="button button--ghost" data-clear-filters>Limpar</button><button type="button" class="button" data-dialog-close data-filters-apply>Ver peças</button></div>
</dialog>`;
  return { body };
}

// ---------------------------------------------------------------- Produto

function inquiryURL(product, selection, whatsappNumber) {
  const message = product.orderMode === 'custom'
    ? `Olá! 👋\nQuero personalizar: ${product.name} — ${SITE_CONFIG.brandName}.\nA minha ideia é: `
    : buildInquiryMessage(inquiryDetails(product, selection));
  return buildWhatsAppURL(whatsappNumber, message);
}

// Estado de stock (produto ou variante) → schema.org. Personalização e "por definir" ficam sem availability.
const AVAILABILITY = { available: 'InStock', low: 'LimitedAvailability', soldout: 'OutOfStock' };
const schemaAvailability = state => (AVAILABILITY[state] ? `https://schema.org/${AVAILABILITY[state]}` : undefined);

export function productJSONLD(product) {
  const url = `${SITE_CONFIG.siteUrl}${productURL(product)}`;
  const range = productPriceRange(product);
  const data = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: product.description,
    image: product.images.map(image => absoluteImageURL(image.src, SITE_CONFIG.siteUrl)),
    brand: { '@type': 'Brand', name: SITE_CONFIG.brandName }, category: categoryLabel(product.category), url
  };
  const breadcrumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_CONFIG.siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Coleção', item: `${SITE_CONFIG.siteUrl}/produtos` },
      { '@type': 'ListItem', position: 3, name: product.name, item: url }
    ]
  };
  // Sem preço não há Product: o Google exige offers (ou avaliações) e marcaria a página com erro.
  if (!range) return jsonLD(breadcrumbs);
  if (range.min === range.max) {
    data.offers = { '@type': 'Offer', price: range.min, priceCurrency: SITE_CONFIG.currency, url, availability: schemaAvailability(productAvailability(product).state) };
  } else {
    // Preços diferentes: uma Offer por variante com preço (as listagens do Google não aceitam AggregateOffer).
    data.offers = product.variants.filter(variant => variantPrice(product, variant) !== null).map(variant => ({
      '@type': 'Offer', name: [variant.color, variant.size].filter(Boolean).join(' / '), sku: variant.sku ?? undefined,
      price: variantPrice(product, variant), priceCurrency: SITE_CONFIG.currency, url,
      availability: product.orderMode === 'cart' ? schemaAvailability(variantStatus(product, variant)) : undefined
    }));
  }
  return jsonLD(data) + jsonLD(breadcrumbs);
}

export function productPage({ product, products, now, whatsappNumber }) {
  const selection = initialSelection(product);
  const range = productPriceRange(product);
  const related = products.filter(item => item.id !== product.id && item.category === product.category)
    .concat(products.filter(item => item.id !== product.id && item.category !== product.category && item.featured))
    .slice(0, 4);
  const body = productShell({
    slug: product.slug,
    breadcrumb: `<li><a href="/produtos?categoria=${product.category}">${escapeHTML(categoryLabel(product.category))}</a></li><li aria-current="page">${escapeHTML(product.name)}</li>`,
    gallery: galleryHTML(product, selection.color),
    header: productHeaderHTML(product, selection),
    purchase: purchaseHTML(product, selection, { inquiryURL: inquiryURL(product, selection, whatsappNumber) }),
    howto: howtoStepsHTML(product),
    related: related.length ? productGridHTML(related, { now }) : ''
  });
  const priceMeta = range ? `<meta property="product:price:amount" content="${range.min}"><meta property="product:price:currency" content="${SITE_CONFIG.currency}">` : '';
  const description = `${product.name} — ${product.productType}. ${product.description}${range ? '' : ` ${PRICE_ON_REQUEST}.`}`.slice(0, 300);
  return { body, head: priceMeta + productJSONLD(product), description, image: product.images[0]?.src, ogType: 'product' };
}

export function productShell({ slug = '', breadcrumb = '', gallery = '', header = '', purchase = '', howto = '', related = '' }) {
  return `<div class="product-page" data-product-page data-slug="${escapeHTML(slug)}">
  <nav class="breadcrumb" aria-label="Estás aqui"><ol data-breadcrumb><li><a href="/">Início</a></li><li><a href="/produtos">Coleção</a></li>${breadcrumb}</ol></nav>
  <article class="product-detail" data-product-detail>
    <div class="product-detail__media" data-gallery-root>${gallery || '<div class="gallery gallery--loading" aria-hidden="true"></div>'}</div>
    <div class="product-detail__panel">
      <div data-product-header>${header || '<p class="product-panel__loading" role="status">A carregar a peça…</p>'}</div>
      <div data-purchase-root>${purchase}</div>
      <ul class="product-assurances">
        <li>${icon('whatsapp')}<span>Pedido confirmado contigo pelo WhatsApp</span></li>
        <li>${icon('check')}<span>Levantamento na loja ou entrega combinada</span></li>
      </ul>
      <details class="product-howto" data-howto${howto ? '' : ' hidden'}>
        <summary>Como funciona o pedido</summary>
        <ol>${howto}</ol>
      </details>
    </div>
  </article>
  <section class="related section" data-related${related ? '' : ' hidden'} aria-labelledby="related-title">
    <div class="section-heading"><div><p class="eyebrow">COMPLETA O LOOK</p><h2 id="related-title">Também podes gostar.</h2></div><a class="text-link" href="/produtos">Ver coleção ↗</a></div>
    <div class="product-grid product-grid--featured" data-related-grid>${related}</div>
  </section>
  <div class="catalog-state" data-product-missing hidden><span class="catalog-state__mark" aria-hidden="true">7</span><h1>Peça não encontrada.</h1><p>Esta linha ainda não foi escrita — ou a peça já não está disponível.</p><a class="button" href="/produtos">Explorar coleção ${icon('arrow')}</a></div>
  <div class="catalog-state" data-product-error hidden role="alert"><h2>Não foi possível carregar a peça.</h2><p>Verifica a tua ligação e tenta novamente.</p><button type="button" class="button" data-retry>Tentar novamente</button></div>
</div>
<dialog class="lightbox" data-lightbox aria-label="Imagem ampliada">
  <button class="icon-button lightbox__close" type="button" data-dialog-close aria-label="Fechar imagem">${icon('close')}</button>
  <button class="icon-button lightbox__nav lightbox__nav--prev" type="button" data-lightbox-prev aria-label="Imagem anterior">${icon('chevronLeft')}</button>
  <figure class="lightbox__figure" data-lightbox-figure></figure>
  <button class="icon-button lightbox__nav lightbox__nav--next" type="button" data-lightbox-next aria-label="Imagem seguinte">${icon('chevronRight')}</button>
</dialog>`;
}

// ---------------------------------------------------------------- Finalizar pedido

export function checkoutPage() {
  const body = `<section class="checkout" data-checkout>
  <h1 class="sr-only">Finalizar pedido</h1>
  <div class="checkout__top">
    <a class="back-link" href="/produtos" data-checkout-back>${icon('back')}<span>Voltar</span></a>
    <ol class="steps" data-steps aria-label="Passos do pedido">
      <li data-step="1" aria-current="step"><span class="steps__n">1</span><span>Dados</span></li>
      <li data-step="2"><span class="steps__n">2</span><span>Resumo</span></li>
      <li data-step="3"><span class="steps__n">3</span><span>WhatsApp</span></li>
    </ol>
  </div>
  <div class="checkout__grid" data-checkout-grid>
    <div class="checkout__main" data-checkout-main tabindex="-1"><p class="checkout__loading" role="status">A preparar o teu pedido…</p>
      <noscript><p>Para finalizar o pedido precisas de ativar o JavaScript. Também podes falar connosco pelo WhatsApp: ${escapeHTML(SITE_CONFIG.contact.phoneDisplay)}.</p></noscript>
    </div>
    <aside class="checkout__aside" data-checkout-aside aria-labelledby="checkout-aside-title"></aside>
  </div>
</section>`;
  return { body, communityBand: false };
}

// ---------------------------------------------------------------- Páginas editoriais (conteúdo original)

// O banner (2,5:1) é recortado com object-fit: cover numa caixa de altura fixa (620px no desktop, 360px no
// telemóvel): a largura pintada é ~altura × 2,5, não a largura da caixa — daí os valores de sizes.
const SERVICES_BANNER_SIZES = '(min-width: 641px) 1550px, 900px';

export function servicesPage({ whatsappNumber }) {
  const start = buildWhatsAppURL(whatsappNumber, 'Olá, quero personalizar uma peça');
  const body = `<section class="page-hero split-hero"><div class="page-hero-copy enter"><p class="eyebrow">PERSONALIZA / À TUA MANEIRA</p><h1>A tua ideia.<br><em>A tua peça.</em></h1><p>Transformamos desenhos, frases, marcas e memórias em roupa que só tu podes vestir.</p><a class="button" href="${escapeHTML(start)}" target="_blank" rel="noopener">Começar no WhatsApp <span>↗</span></a></div><div class="page-hero-image">${imgHTML('personalizacao-banner', { alt: 'Exemplos de vestuário que pode ser personalizado', sizes: SERVICES_BANNER_SIZES, loading: 'eager', fetchpriority: 'high' })}<span>DA IDEIA À RUA / 01</span></div></section>
<section class="service-intro section reveal"><div><p class="eyebrow">O QUE PODES CRIAR</p><h2>Sem limites.<br>Só possibilidades.</h2></div><p>Personalizamos t-shirts, polos, hoodies, uniformes e sacolas. Podes trazer uma arte pronta ou apenas uma ideia: ajudamos a escolher a peça, a técnica e a posição que melhor conta a tua história.</p></section>
<section class="service-cards section"><article class="feature-card reveal"><span>01</span><div class="feature-icon" aria-hidden="true">✦</div><h3>Serigrafia</h3><p>Cores sólidas e alta durabilidade. Ideal para equipas, eventos, marcas e encomendas em quantidade.</p></article><article class="feature-card reveal"><span>02</span><div class="feature-icon" aria-hidden="true">◉</div><h3>Impressão DTF</h3><p>Detalhes nítidos, muitas cores e liberdade criativa. Perfeita para peças únicas e artes complexas.</p></article><article class="feature-card reveal"><span>03</span><div class="feature-icon" aria-hidden="true">↗</div><h3>Apoio criativo</h3><p>Ainda não tens a arte final? Conversamos contigo e encontramos uma solução que funciona na peça.</p></article></section>
<section class="process section reveal"><p class="eyebrow">SIMPLES DO INÍCIO AO FIM</p><h2>Como funciona.</h2><div class="process-line"><article><b>01</b><h3>Partilha a ideia</h3><p>Envia a imagem, frase, logótipo ou referência pelo WhatsApp.</p></article><article><b>02</b><h3>Escolhe os detalhes</h3><p>Definimos peça, cor, tamanho, quantidade, técnica e prazo.</p></article><article><b>03</b><h3>Aprova e criamos</h3><p>Confirmas a proposta e produzimos tudo com atenção.</p></article><article><b>04</b><h3>Recebe e veste</h3><p>Combinamos o levantamento ou a melhor forma de entrega.</p></article></div></section>
<section class="material-band"><div><strong>100%</strong><span>ALGODÃO<br>DISPONÍVEL</span></div><div><strong>02</strong><span>TÉCNICAS<br>DE IMPRESSÃO</span></div><div><strong>01</strong><span>PEÇA ÚNICA<br>COMO TU</span></div></section>`;
  return { body };
}

export function storyPage() {
  const body = `<section class="page-hero story-hero"><div class="story-title enter"><p class="eyebrow">A NOSSA HISTÓRIA / DESDE 2025</p><h1>SETE LINHAS.<br><em>UM PROPÓSITO.</em></h1></div><div class="story-hero-grid">${imgHTML('polos-grupo', { alt: 'Jovens a vestir God Seven Line', sizes: '(min-width: 641px) 66vw, 100vw', loading: 'eager' })}<div class="story-manifesto"><span aria-hidden="true">✳</span><p>Algumas linhas foram tortas. Outras, rectas. Em todas elas, Deus guiou o caminho.</p></div></div></section>
<section class="origin section reveal"><div><p class="eyebrow">19 JULHO / 2025</p><h2>Onde tudo começou.</h2></div><div><p>A God Seven Line nasceu em Moçambique depois de várias etapas que se tornaram sete linhas. Cada uma marcou a nossa história e ajudou a construir a marca que somos hoje.</p><p>O mais importante é que algumas linhas ainda não foram escritas. A história continua contigo, em cada peça e em cada ideia que ganha vida.</p></div></section>
<section class="name-grid section"><article class="name-card reveal"><strong>GOD</strong><h3>Direcção</h3><p>Deus esteve presente em cada caminho, nos fáceis e nos difíceis.</p></article><article class="name-card dark reveal"><strong>SEVEN</strong><h3>Propósito</h3><p>O número sete representa perfeição, propósito e ciclos completados.</p></article><article class="name-card accent reveal"><strong>LINE</strong><h3>História</h3><p>Cada linha mostra um caminho vivido e uma nova história por escrever.</p></article></section>
<section class="values section reveal"><div><p class="eyebrow">O QUE NOS MOVE</p><h2>Roupa com<br>significado.</h2></div><div class="value-list"><p><span>01</span><strong>Identidade</strong> Peças para quem não tem medo de se destacar.</p><p><span>02</span><strong>Qualidade</strong> Algodão, dry fit e tintas feitas para durar.</p><p><span>03</span><strong>Comunidade</strong> Uma marca local construída com quem a veste.</p><p><span>04</span><strong>Futuro</strong> Novas linhas, uma loja física e histórias além de Moçambique.</p></div></section>`;
  return { body };
}

export function locationPage({ whatsappNumber }) {
  const directions = buildWhatsAppURL(whatsappNumber, 'Olá, preciso de indicações para chegar à loja');
  const { contact } = SITE_CONFIG;
  const hours = contact.hours.map(item => `<p><span>${escapeHTML(item.days)}</span><strong>${escapeHTML(item.time)}</strong></p>`).join('');
  const addressTitle = escapeHTML(contact.addressTitle ?? `${contact.address}.`).replace(/\n/g, '<br>');
  const body = `<section class="page-hero location-hero"><div class="page-hero-copy enter"><p class="eyebrow">ENCONTRA-NOS / MANHIÇA</p><h1>Vem viver<br><em>a linha.</em></h1><p>Vê as peças de perto, conversa connosco e começa a tua próxima história.</p><a class="button" href="${escapeHTML(directions)}" target="_blank" rel="noopener">Pedir indicações <span>↗</span></a></div><div class="location-art" aria-hidden="true"><span class="map-pin">7</span><div class="road one"></div><div class="road two"></div><p>VILA DA<br><strong>MANHIÇA</strong></p></div></section>
<section class="visit-grid section reveal"><article><p class="eyebrow">01 / MORADA</p><h2>${addressTitle}</h2><p>${escapeHTML(contact.city)}. Procura a identidade God Seven Line.</p></article><article><p class="eyebrow">02 / HORÁRIO</p><div class="hours">${hours}</div></article></section>
<section class="location-photo reveal">${imgHTML('signature-preto', { alt: 'Comunidade God Seven Line em Moçambique', sizes: '(min-width: 641px) 57vw, 100vw' })}<div><p class="eyebrow">ANTES DE VIRES</p><h2>Confirma a tua visita.</h2><p>Envia uma mensagem para confirmar disponibilidade de peças, tamanhos e atendimento.</p><a class="text-link" href="/contactos">Falar connosco ↗</a></div></section>`;
  return { body };
}

export function contactPage({ whatsappNumber }) {
  const instagram = SITE_CONFIG.social.instagram;
  const body = `<section class="sobre-conteudo"><p class="eyebrow">ESTAMOS POR AQUI</p><h1>Vamos conversar.</h1><p class="intro">Uma peça que te chamou a atenção? Uma ideia para personalizar? Fala connosco.</p><div class="contact-grid"><a class="contact-card" href="${escapeHTML(buildWhatsAppURL(whatsappNumber))}" target="_blank" rel="noopener"><span>01 / ENCOMENDAS</span><h2>WhatsApp ↗</h2><p>${escapeHTML(SITE_CONFIG.contact.phoneDisplay)}</p><p>Preços, tamanhos e personalização.</p></a><a class="contact-card" href="${instagram.url}" target="_blank" rel="noopener"><span>02 / COMUNIDADE</span><h2>Instagram ↗</h2><p>${escapeHTML(instagram.handle)}</p><p>Inspiração e novidades da marca.</p></a></div><div class="sobre-bloco"><h2>Vem conhecer-nos.</h2><p>${escapeHTML(SITE_CONFIG.contact.address)}.</p><p>${SITE_CONFIG.contact.hours.map(item => `${escapeHTML(item.days)} · ${escapeHTML(item.time)}`).join('<br>')}</p><a class="text-link" href="/Localizacao">Ver localização ↗</a></div></section>`;
  return { body };
}

export function notFoundPage() {
  const body = `<section class="not-found section"><p class="eyebrow">ERRO 404</p><h1>Esta linha ainda<br>não foi escrita.</h1><p>A página que procuras não existe ou mudou de lugar.</p><div class="hero-actions"><a class="button" href="/produtos">Explorar coleção <span>↗</span></a><a class="text-link" href="/">Voltar ao início</a></div></section>`;
  return { body };
}

export { productShell as productFallbackShell };
