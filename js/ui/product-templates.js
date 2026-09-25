// Templates da página de produto (partilhados entre build e browser).
import { SITE_CONFIG, categoryLabel } from '../../config/site.js';
import {
  imagesForColor, isVariantPurchasable, productAvailability, productColors, productHasSizes,
  productPriceLabel, variantPrice, variantStatus, variantsForColor
} from '../lib/catalog.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML } from '../lib/images.js';
import { unitsLabel } from '../lib/cart.js';
import { icon } from './templates.js';

export const GALLERY_SIZES = '(min-width: 1024px) 52vw, 100vw';

// Seleção inicial: primeira cor com stock; tamanho só é pré-selecionado quando é único.
export function initialSelection(product) {
  const colors = productColors(product);
  const color = (colors.find(item => item.available) ?? colors[0])?.name ?? null;
  const variants = color ? variantsForColor(product, color) : [];
  const single = variants.length === 1 && !variants[0].size ? variants[0] : null;
  return { color, variantId: single && isVariantPurchasable(product, single) ? single.id : null, quantity: 1 };
}

export function galleryHTML(product, color) {
  const images = imagesForColor(product, color);
  const count = images.length;
  const slides = images.map((image, index) => `<li class="gallery__slide" data-slide="${index}">
      <button type="button" class="gallery__zoom" data-zoom="${index}" aria-label="Ampliar imagem ${index + 1} de ${count}">
        ${imgHTML(image.src, { alt: image.alt || product.name, sizes: GALLERY_SIZES, loading: index === 0 ? 'eager' : 'lazy', fetchpriority: index === 0 ? 'high' : null })}
        <span class="gallery__expand">${icon('expand')}</span>
      </button>
    </li>`).join('');
  const thumbs = count > 1 ? `<div class="gallery__thumbs" role="group" aria-label="Escolher imagem">${images.map((image, index) => `
      <button type="button" class="gallery__thumb" data-thumb="${index}" aria-label="Ver imagem ${index + 1} de ${count}"${index === 0 ? ' aria-current="true"' : ''}>
        ${imgHTML(image.src, { alt: '', sizes: '96px' })}
      </button>`).join('')}
    </div>
    <div class="gallery__dots" aria-hidden="true">${images.map((_, index) => `<span${index === 0 ? ' class="is-active"' : ''}></span>`).join('')}</div>` : '';
  return `<div class="gallery" data-gallery data-count="${count}">
    <div class="gallery__viewport" data-gallery-viewport${count > 1 ? ` tabindex="0" role="region" aria-roledescription="carrossel" aria-label="${escapeHTML(`Imagens de ${product.name}`)}"` : ''}>
      <ul class="gallery__track">${slides}</ul>
    </div>
    ${thumbs}
  </div>`;
}

function colorsHTML(product, selection, { forInquiry = false } = {}) {
  const colors = productColors(product);
  if (!colors.length || (colors.length === 1 && colors[0].name === 'Único')) return '';
  return `<fieldset class="option-group" data-color-group>
    <legend class="option-group__legend">Cor: <strong data-color-name>${escapeHTML(selection.color ?? '')}</strong></legend>
    <div class="swatches">${colors.map(color => `
      <label class="swatch${!color.available && !forInquiry ? ' is-soldout' : ''}" style="--swatch:${escapeHTML(color.hex)}" title="${escapeHTML(color.name)}">
        <input type="radio" name="color" value="${escapeHTML(color.name)}"${color.name === selection.color ? ' checked' : ''}>
        <span class="swatch__dot" aria-hidden="true"></span>
        <span class="sr-only">${escapeHTML(color.name)}${!color.available && !forInquiry ? ' (esgotada)' : ''}</span>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

function sizeState(product, variant, forInquiry) {
  if (forInquiry) return { disabled: false, note: '' };
  const status = variantStatus(product, variant);
  if (status === 'soldout') return { disabled: true, note: 'ESGOTADO' };
  if (status === 'unconfigured') return { disabled: true, note: 'INDISPONÍVEL' };
  if (status === 'low') return { disabled: false, note: variant.stock === 1 ? 'ÚLTIMA' : `ÚLTIMAS ${variant.stock}` };
  return { disabled: false, note: '' };
}

export function sizesHTML(product, selection, { forInquiry = false } = {}) {
  if (!productHasSizes(product)) return '';
  const variants = selection.color ? variantsForColor(product, selection.color) : [];
  return `<fieldset class="option-group" data-size-group>
    <legend class="option-group__legend">Tamanho</legend>
    <div class="size-options">${variants.map(variant => {
      const state = sizeState(product, variant, forInquiry);
      return `<label class="size-option${state.disabled ? ' is-disabled' : ''}">
        <input type="radio" name="variant" value="${escapeHTML(variant.id)}"${variant.id === selection.variantId ? ' checked' : ''}${state.disabled ? ' disabled' : ''}>
        <span class="size-option__label">${escapeHTML(variant.size ?? 'Único')}${state.note ? `<small>${state.note}</small>` : ''}</span>
      </label>`;
    }).join('')}
    </div>
    ${forInquiry ? '' : '<p class="option-message" data-stock-message aria-live="polite"></p>'}
  </fieldset>`;
}

export function stockMessage(product, variant) {
  if (!variant) return productHasSizes(product) ? 'Seleciona um tamanho.' : '';
  const status = variantStatus(product, variant);
  if (status === 'soldout') return 'Esgotado.';
  if (status === 'low') return variant.stock === 1 ? 'Última unidade.' : `Últimas ${variant.stock} unidades.`;
  if (status === 'available') return `Em stock — ${unitsLabel(variant.stock)}.`;
  return 'Indisponível.';
}

export function selectedVariant(product, selection) {
  return product.variants.find(variant => variant.id === selection.variantId) ?? null;
}

export function unitPriceLabel(product, selection) {
  const variant = selectedVariant(product, selection);
  const price = variant ? variantPrice(product, variant) : null;
  return price !== null ? formatPrice(price) : productPriceLabel(product);
}

function purchaseFormHTML(product, selection) {
  const variant = selectedVariant(product, selection);
  const { state } = productAvailability(product);
  const soldout = state === 'soldout';
  const max = variant && Number.isInteger(variant.stock) ? variant.stock : 1;
  const price = variant ? variantPrice(product, variant) : null;
  return `<form class="purchase-form" data-purchase-form novalidate>
    ${colorsHTML(product, selection)}
    ${sizesHTML(product, selection)}
    <div class="quantity-field">
      <span class="option-group__legend" id="quantity-label">Quantidade</span>
      <div class="quantity-field__row">
        <div class="stepper" role="group" aria-labelledby="quantity-label">
          <button type="button" data-qty-dec aria-label="Diminuir quantidade"${selection.quantity <= 1 ? ' disabled' : ''}>${icon('minus')}</button>
          <input type="number" name="quantity" value="${selection.quantity}" min="1" max="${max}" step="1" inputmode="numeric" data-qty-input aria-labelledby="quantity-label"${soldout ? ' disabled' : ''}>
          <button type="button" data-qty-inc aria-label="Aumentar quantidade"${!variant || selection.quantity >= max ? ' disabled' : ''}>${icon('plus')}</button>
        </div>
        <p class="quantity-field__subtotal" data-line-subtotal${price === null ? ' hidden' : ''}>Subtotal <strong>${price === null ? '' : formatPrice(price * selection.quantity)}</strong></p>
      </div>
    </div>
    <p class="form-error" data-purchase-error role="alert"></p>
    <button type="submit" class="button button--block add-button" data-add-button${soldout ? ' disabled' : ''}>
      <span data-add-label>${soldout ? 'ESGOTADO' : 'ADICIONAR AO PEDIDO'}</span>${soldout ? '' : icon('arrow')}
    </button>
  </form>`;
}

function inquiryHTML(product, selection, whatsappURL) {
  const custom = product.orderMode === 'custom';
  return `<form class="purchase-form purchase-form--inquiry" data-inquiry-form>
    ${custom ? '' : colorsHTML(product, selection, { forInquiry: true })}
    ${custom ? '' : sizesHTML(product, selection, { forInquiry: true })}
    <div class="inquiry-note">
      <strong>${custom ? 'Peça feita à tua medida.' : 'Preço e disponibilidade por confirmar.'}</strong>
      <p>${custom
        ? 'Conta-nos a tua ideia: combinamos a peça, a técnica, o preço e o prazo contigo pelo WhatsApp.'
        : 'Esta peça ainda não tem preço e stock publicados. Pergunta-nos pelo WhatsApp e confirmamos contigo.'}</p>
    </div>
    <a class="button button--block button--whatsapp" data-inquiry-link href="${escapeHTML(whatsappURL)}" target="_blank" rel="noopener">
      ${icon('whatsapp')}<span>${custom ? 'PERSONALIZAR NO WHATSAPP' : 'PERGUNTAR NO WHATSAPP'}</span>
    </a>
    ${custom ? '<a class="text-link inquiry-secondary" href="/servicos">Ver como funciona a personalização ↗</a>' : ''}
  </form>`;
}

export function purchaseHTML(product, selection, { inquiryURL = '' } = {}) {
  const { state } = productAvailability(product);
  return ['custom', 'unconfigured', 'unavailable'].includes(state)
    ? inquiryHTML(product, selection, inquiryURL)
    : purchaseFormHTML(product, selection);
}

export function productHeaderHTML(product, selection) {
  return `<p class="eyebrow product-panel__eyebrow">${escapeHTML(categoryLabel(product.category).toUpperCase())} / ${escapeHTML(SITE_CONFIG.brandName.toUpperCase())}</p>
    <h1 class="product-panel__title">${escapeHTML(product.name)}</h1>
    <p class="product-panel__type">${escapeHTML(product.productType)}</p>
    <p class="product-panel__price" data-price>${escapeHTML(unitPriceLabel(product, selection))}</p>
    <p class="product-panel__description">${escapeHTML(product.description)}</p>`;
}
