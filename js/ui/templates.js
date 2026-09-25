// Templates HTML partilhados entre o build (páginas estáticas) e o browser (re-render com dados ao vivo).
// Puro: sem DOM, sem window.
import { SITE_CONFIG, categoryLabel } from '../../config/site.js';
import {
  PRICE_ON_REQUEST, productAvailability, productBadge, productColors, productPriceLabel, productURL
} from '../lib/catalog.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML } from '../lib/images.js';

export const CARD_SIZES = '(min-width: 1100px) 25vw, (min-width: 700px) 33vw, 50vw';

export function icon(name) {
  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20z"/><path d="M9 9.5c.3 2.3 2.2 4.2 4.5 4.6l1-1.2 2 1-.4 1.5c-3.9.4-7.4-3.1-7-7l1.5-.4 1 2z"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    chevronLeft: '<path d="m15 5-7 7 7 7"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>'
  };
  return `<svg class="icon icon--${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
}

export function colorDotsHTML(product) {
  const colors = productColors(product);
  if (!colors.length || (colors.length === 1 && colors[0].name === 'Único')) return '';
  const names = colors.map(color => color.name).join(', ');
  return `<ul class="color-dots" aria-label="${escapeHTML(`${colors.length === 1 ? 'Cor' : 'Cores'}: ${names}`)}">${colors
    .map(color => `<li style="--swatch:${escapeHTML(color.hex)}" title="${escapeHTML(color.name)}"></li>`).join('')}</ul>`;
}

export function badgeHTML(product, now) {
  const badge = productBadge(product, now);
  return badge ? `<span class="product-tag product-tag--${badge.id}">${escapeHTML(badge.label)}</span>` : '';
}

export function priceHTML(product) {
  const label = productPriceLabel(product);
  return `<span class="price${label === PRICE_ON_REQUEST ? ' price--request' : ''}">${escapeHTML(label)}</span>`;
}

export function productCardHTML(product, { now = new Date(), heading = 'h3', eager = false } = {}) {
  const url = productURL(product);
  const [primary, secondary] = product.images;
  const { state } = productAvailability(product);
  const alt = primary?.alt || product.name;
  return `<article class="product product-card" data-product-card data-state="${state}">
  <a class="product-image" href="${url}" tabindex="-1" aria-hidden="true">
    ${imgHTML(primary?.src, { alt, sizes: CARD_SIZES, className: 'product-card__img', loading: eager ? 'eager' : 'lazy' })}
    ${secondary ? imgHTML(secondary.src, { alt: '', sizes: CARD_SIZES, className: 'product-card__img product-card__img--alt' }) : ''}
    ${badgeHTML(product, now)}
    <span class="product-card__cta">VER PEÇA ${icon('arrow')}</span>
  </a>
  <div class="product-info">
    <div class="product-card__text">
      <${heading} class="product-card__name"><a href="${url}">${escapeHTML(product.name)}</a></${heading}>
      <p class="product-category">${escapeHTML(product.productType || categoryLabel(product.category))}</p>
    </div>
    ${priceHTML(product)}
  </div>
  ${colorDotsHTML(product)}
</article>`;
}

export function productGridHTML(products, options) {
  return products.map((product, index) => productCardHTML(product, { ...options, eager: options?.eager && index < 2 })).join('');
}

// Linha do pedido (gaveta e checkout).
export function cartLineHTML(line, { editable = true, productsLoaded = true } = {}) {
  const url = line.slug ? `/produtos/${encodeURIComponent(line.slug)}` : '/produtos';
  const variant = [line.color, line.size || 'Único'].filter(Boolean).join(' / ');
  const atMax = line.maxQuantity !== null && line.quantity >= line.maxQuantity;
  const label = `${line.name} ${variant}`;
  const controls = editable ? `<div class="cart-line__actions">
      <div class="stepper stepper--sm" role="group" aria-label="${escapeHTML(`Quantidade de ${label}`)}">
        <button type="button" data-line-dec="${escapeHTML(line.variantId)}" aria-label="Diminuir quantidade" ${line.quantity <= 1 || !productsLoaded ? 'disabled' : ''}>${icon('minus')}</button>
        <output aria-live="polite">${line.quantity}</output>
        <button type="button" data-line-inc="${escapeHTML(line.variantId)}" aria-label="Aumentar quantidade" ${atMax || !productsLoaded ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
      <button type="button" class="cart-line__remove" data-line-remove="${escapeHTML(line.variantId)}" aria-label="${escapeHTML(`Remover ${label}`)}">${icon('trash')}<span>Remover</span></button>
    </div>${atMax ? `<p class="cart-line__note">Máximo disponível: ${line.maxQuantity}</p>` : ''}` : '';
  return `<li class="cart-line" data-line="${escapeHTML(line.variantId)}">
    <a class="cart-line__image" href="${url}" tabindex="-1" aria-hidden="true">${imgHTML(line.image, { alt: '', sizes: '96px' })}</a>
    <div class="cart-line__body">
      <div class="cart-line__head">
        <h3 class="cart-line__name"><a href="${url}">${escapeHTML(line.name)}</a></h3>
        <strong class="cart-line__total">${formatPrice(line.lineTotal)}</strong>
      </div>
      <p class="cart-line__variant">${escapeHTML(variant)}</p>
      <p class="cart-line__unit">${line.quantity} × ${formatPrice(line.unitPrice)}</p>
      ${controls}
    </div>
  </li>`;
}

export function totalsHTML(totals) {
  const fee = totals.deliveryFee !== null
    ? `<div><dt>Entrega</dt><dd>${formatPrice(totals.deliveryFee)}</dd></div>` : '';
  return `<dl class="cart-summary">
    <div><dt>Subtotal</dt><dd>${formatPrice(totals.subtotal)}</dd></div>${fee}
    <div class="cart-summary__total"><dt>Total</dt><dd>${formatPrice(totals.total)}</dd></div>
  </dl>`;
}

export function emptyOrderHTML() {
  return `<div class="empty-order">
    <span class="empty-order__mark" aria-hidden="true">7</span>
    <h3>O teu pedido está vazio.</h3>
    <p>Encontra uma peça para começar a tua próxima história.</p>
    <a class="button" href="/produtos">EXPLORAR COLEÇÃO ${icon('arrow')}</a>
  </div>`;
}

export const categoriesForFilter = () => [{ id: '', label: 'Todos' }, ...SITE_CONFIG.categories];
