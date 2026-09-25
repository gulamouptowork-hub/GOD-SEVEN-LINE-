// Página de produto: cor → tamanho → quantidade → ADICIONAR AO PEDIDO.
import { track } from '../analytics.js';
import { cart, catalog } from '../app-context.js';
import { SITE_CONFIG, categoryLabel } from '../../config/site.js';
import { CartError } from '../lib/cart.js';
import {
  isVariantPurchasable, productHasSizes, variantPrice, variantStatus, variantsForColor
} from '../lib/catalog.js';
import { formatPrice } from '../lib/format.js';
import { escapeHTML } from '../lib/html.js';
import { imgHTML, resolveImage } from '../lib/images.js';
import { buildInquiryMessage, buildWhatsAppURL } from '../lib/whatsapp.js';
import { runtime } from '../services/runtime.js';
import { showAddedPanel } from '../ui/cart-drawer.js';
import { $, $$, on } from '../ui/dom.js';
import { openModal } from '../ui/dialogs.js';
import {
  galleryHTML, initialSelection, productHeaderHTML, purchaseHTML, selectedVariant, stockMessage, unitPriceLabel
} from '../ui/product-templates.js';
import { icon, productGridHTML } from '../ui/templates.js';
import { toast } from '../ui/toast.js';

function slugFromLocation(page) {
  if (page.dataset.slug) return page.dataset.slug;
  const match = location.pathname.match(/^\/produtos\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : new URLSearchParams(location.search).get('slug') ?? '';
}

function inquiryURL(product, selection) {
  const variant = selectedVariant(product, selection);
  const message = product.orderMode === 'custom'
    ? `Olá! 👋\nQuero personalizar: ${product.name} — ${SITE_CONFIG.brandName}.\nA minha ideia é: `
    : buildInquiryMessage({ productName: product.name, color: selection.color, size: variant?.size });
  return buildWhatsAppURL(runtime.whatsappNumber, message);
}

export async function init() {
  const page = $('[data-product-page]');
  if (!page) return;
  const slug = slugFromLocation(page);
  const isFallback = !page.dataset.slug;
  const detail = $('[data-product-detail]', page);
  const missing = $('[data-product-missing]', page);
  const errorState = $('[data-product-error]', page);
  const galleryRoot = $('[data-gallery-root]', page);
  const headerRoot = $('[data-product-header]', page);
  const purchaseRoot = $('[data-purchase-root]', page);
  const lightbox = $('[data-lightbox]');
  let product;
  let selection;
  let feedbackTimer;

  // ---------------------------------------------------------------- render
  function renderPurchase({ focusColor = null } = {}) {
    purchaseRoot.innerHTML = purchaseHTML(product, selection, { inquiryURL: inquiryURL(product, selection) });
    if (focusColor) $(`input[name="color"][value="${CSS.escape(focusColor)}"]`, purchaseRoot)?.focus();
    updateSelectionUI();
  }

  function renderGallery() {
    galleryRoot.innerHTML = galleryHTML(product, selection.color);
    setupGallery();
  }

  const inCart = variant => cart.getItems().find(item => item.variantId === variant?.id)?.quantity ?? 0;
  const available = variant => (variant && Number.isInteger(variant.stock) ? Math.max(variant.stock - inCart(variant), 0) : 0);

  function updateSelectionUI() {
    const price = $('[data-price]', headerRoot);
    if (price) price.textContent = unitPriceLabel(product, selection);
    const colorName = $('[data-color-name]', purchaseRoot);
    if (colorName) colorName.textContent = selection.color ?? '';
    const form = $('[data-purchase-form]', purchaseRoot);
    const inquiry = $('[data-inquiry-link]', purchaseRoot);
    if (inquiry) inquiry.href = inquiryURL(product, selection);
    if (!form) return;
    const variant = selectedVariant(product, selection);
    const left = available(variant);
    const max = Math.max(left, 1);
    selection.quantity = Math.min(selection.quantity, max);
    const message = $('[data-stock-message]', form);
    if (message) {
      message.textContent = variant && inCart(variant)
        ? (left ? `${stockMessage(product, variant)} Já tens ${inCart(variant)} no teu pedido.` : 'Já tens todas as unidades disponíveis deste tamanho no teu pedido.')
        : stockMessage(product, variant);
      message.classList.toggle('is-low', variantStatus(product, variant) === 'low');
      message.classList.remove('is-error');
    }
    $('[data-size-group]', form)?.classList.remove('has-error');
    const input = $('[data-qty-input]', form);
    input.max = String(max);
    input.value = String(selection.quantity);
    $('[data-qty-dec]', form).disabled = selection.quantity <= 1;
    $('[data-qty-inc]', form).disabled = !variant || selection.quantity >= left;
    const unit = variant ? variantPrice(product, variant) : null;
    const subtotal = $('[data-line-subtotal]', form);
    subtotal.hidden = unit === null;
    if (unit !== null) subtotal.querySelector('strong').textContent = formatPrice(unit * selection.quantity);
    const button = $('[data-add-button]', form);
    const soldout = product.variants.every(item => !isVariantPurchasable(product, item));
    if (!button.classList.contains('is-added')) {
      button.disabled = soldout || Boolean(variant && left === 0);
      $('[data-add-label]', button).textContent = soldout ? 'ESGOTADO' : 'ADICIONAR AO PEDIDO';
    }
    $('[data-purchase-error]', form).textContent = '';
  }

  function setQuantity(value) {
    const variant = selectedVariant(product, selection);
    const max = Math.max(available(variant), 1);
    const next = Math.min(Math.max(1, Math.floor(Number(value) || 1)), max);
    if (Number(value) > max && variant) toast(`Só temos ${max} ${max === 1 ? 'unidade' : 'unidades'} deste tamanho.`);
    selection.quantity = next;
    updateSelectionUI();
  }

  function showError(message, { sizeGroup = false } = {}) {
    const form = $('[data-purchase-form]', purchaseRoot);
    $('[data-purchase-error]', form).textContent = message;
    if (sizeGroup) {
      const group = $('[data-size-group]', form);
      group?.classList.add('has-error');
      const stock = $('[data-stock-message]', form);
      if (stock) { stock.textContent = message; stock.classList.add('is-error'); }
      $('input[name="variant"]:not(:disabled)', form)?.focus();
    }
  }

  function added(line, quantity) {
    const button = $('[data-add-button]', purchaseRoot);
    clearTimeout(feedbackTimer);
    button.classList.add('is-added');
    button.innerHTML = `${icon('check')}<span data-add-label>ADICIONADO AO PEDIDO</span>`;
    feedbackTimer = setTimeout(() => {
      button.classList.remove('is-added');
      button.innerHTML = `<span data-add-label>ADICIONAR AO PEDIDO</span>${icon('arrow')}`;
      updateSelectionUI();
    }, 2200);
    showAddedPanel(line, quantity);
  }

  // ---------------------------------------------------------------- eventos
  on(purchaseRoot, 'change', 'input[name="color"]', (event, input) => {
    const previousImages = product.images.filter(image => image.color).length;
    selection = { ...selection, color: input.value, variantId: null, quantity: 1 };
    const variants = variantsForColor(product, input.value);
    if (variants.length === 1 && !variants[0].size && isVariantPurchasable(product, variants[0])) selection.variantId = variants[0].id;
    renderPurchase({ focusColor: input.value });
    if (previousImages) renderGallery();
  });
  on(purchaseRoot, 'change', 'input[name="variant"]', (event, input) => {
    const variant = product.variants.find(item => item.id === input.value);
    selection.variantId = variant?.id ?? null;
    if (variant && Number.isInteger(variant.stock)) selection.quantity = Math.min(selection.quantity, Math.max(variant.stock, 1));
    updateSelectionUI();
    if (variant) track('select_size', { productId: product.id, slug: product.slug, size: variant.size, color: variant.color });
  });
  on(purchaseRoot, 'click', '[data-qty-dec]', () => setQuantity(selection.quantity - 1));
  on(purchaseRoot, 'click', '[data-qty-inc]', () => {
    const variant = selectedVariant(product, selection);
    if (!variant) { showError('Seleciona um tamanho.', { sizeGroup: true }); return; }
    setQuantity(selection.quantity + 1);
  });
  on(purchaseRoot, 'change', '[data-qty-input]', (event, input) => setQuantity(input.value));
  purchaseRoot.addEventListener('submit', event => {
    if (!event.target.matches('[data-purchase-form]')) return;
    event.preventDefault();
    if (!cart.productsLoaded) { showError('O catálogo ainda está a carregar. Tenta novamente.'); return; }
    const variant = selectedVariant(product, selection);
    if (!variant) {
      showError(productHasSizes(product) ? 'Seleciona um tamanho.' : 'Seleciona uma opção.', { sizeGroup: true });
      return;
    }
    try {
      const quantity = selection.quantity;
      const line = cart.add(product.id, variant.id, quantity);
      track('add_to_cart', { productId: product.id, variantId: variant.id, quantity, value: line.unitPrice * quantity });
      selection.quantity = 1;
      added(line, quantity);
      updateSelectionUI();
    } catch (error) {
      showError(error instanceof CartError ? error.message : 'Não foi possível adicionar ao pedido.', { sizeGroup: error?.code === 'VARIANT_REQUIRED' });
    }
  });

  // ---------------------------------------------------------------- galeria
  function setupGallery() {
    const gallery = $('[data-gallery]', galleryRoot);
    const viewport = $('[data-gallery-viewport]', galleryRoot);
    if (!gallery || !viewport) return;
    const slides = $$('.gallery__slide', viewport);
    const thumbs = $$('[data-thumb]', gallery);
    const dots = $$('.gallery__dots span', gallery);
    const go = index => viewport.scrollTo({ left: index * viewport.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const mark = index => {
      thumbs.forEach((thumb, i) => (i === index ? thumb.setAttribute('aria-current', 'true') : thumb.removeAttribute('aria-current')));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    };
    thumbs.forEach(thumb => thumb.addEventListener('click', () => go(Number(thumb.dataset.thumb))));
    let frame;
    viewport.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mark(Math.round(viewport.scrollLeft / Math.max(viewport.clientWidth, 1))));
    }, { passive: true });
    viewport.addEventListener('keydown', event => {
      const current = Math.round(viewport.scrollLeft / Math.max(viewport.clientWidth, 1));
      if (event.key === 'ArrowRight') { event.preventDefault(); go(Math.min(current + 1, slides.length - 1)); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(Math.max(current - 1, 0)); }
    });
    $$('[data-zoom]', gallery).forEach(button => button.addEventListener('click', () => openLightbox(Number(button.dataset.zoom))));
  }

  let lightboxIndex = 0;
  function lightboxImages() {
    return product.images.filter(image => !image.color || image.color === selection.color);
  }
  function showLightbox(index) {
    const images = lightboxImages().length ? lightboxImages() : product.images;
    lightboxIndex = (index + images.length) % images.length;
    const image = images[lightboxIndex];
    const { srcset } = resolveImage(image.src);
    $('[data-lightbox-figure]', lightbox).innerHTML = `${imgHTML(image.src, { alt: image.alt || product.name, sizes: '92vw', loading: 'eager' })}`;
    if (!srcset) $('[data-lightbox-figure] img', lightbox).removeAttribute('sizes');
    lightbox.dataset.count = String(images.length);
  }
  function openLightbox(index) {
    if (!lightbox) return;
    showLightbox(index);
    openModal(lightbox, { focus: '[data-dialog-close]' });
  }
  $('[data-lightbox-prev]', lightbox ?? document)?.addEventListener('click', () => showLightbox(lightboxIndex - 1));
  $('[data-lightbox-next]', lightbox ?? document)?.addEventListener('click', () => showLightbox(lightboxIndex + 1));
  lightbox?.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') showLightbox(lightboxIndex + 1);
    if (event.key === 'ArrowLeft') showLightbox(lightboxIndex - 1);
  });

  // ---------------------------------------------------------------- carregar
  function renderFallbackMeta() {
    document.title = `${product.name} — ${product.productType} — ${SITE_CONFIG.brandName}`;
    $('meta[name="description"]')?.setAttribute('content', product.description);
    $('[data-breadcrumb]', page).innerHTML = `<li><a href="/">Início</a></li><li><a href="/produtos">Coleção</a></li><li><a href="/produtos?categoria=${escapeHTML(product.category)}">${escapeHTML(categoryLabel(product.category))}</a></li><li aria-current="page">${escapeHTML(product.name)}</li>`;
  }

  function readStaticSelection() {
    const color = $('input[name="color"]:checked', purchaseRoot)?.value;
    const variantId = $('input[name="variant"]:checked', purchaseRoot)?.value;
    const base = initialSelection(product);
    if (color && product.variants.some(variant => variant.color === color)) base.color = color;
    const variant = product.variants.find(item => item.id === variantId && item.color === base.color);
    if (variant && isVariantPurchasable(product, variant)) base.variantId = variant.id;
    return base;
  }

  async function load() {
    errorState.hidden = true;
    try {
      const { products } = await catalog();
      product = products.find(item => item.slug === slug);
      if (!product) {
        detail.hidden = true;
        $('[data-related]', page).hidden = true;
        missing.hidden = false;
        document.title = `Peça não encontrada — ${SITE_CONFIG.brandName}`;
        if (!$('meta[name="robots"]')) document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex">');
        return;
      }
      detail.hidden = false;
      selection = readStaticSelection();
      if (isFallback) renderFallbackMeta();
      headerRoot.innerHTML = productHeaderHTML(product, selection);
      renderGallery();
      renderPurchase();
      const related = products.filter(item => item.id !== product.id && item.category === product.category)
        .concat(products.filter(item => item.id !== product.id && item.category !== product.category && item.featured)).slice(0, 4);
      const relatedSection = $('[data-related]', page);
      relatedSection.hidden = !related.length;
      $('[data-related-grid]', page).innerHTML = productGridHTML(related);
      track('view_product', { productId: product.id, slug: product.slug, name: product.name });
    } catch {
      if (isFallback) detail.hidden = true;
      errorState.hidden = false;
      const form = $('[data-purchase-form]', purchaseRoot);
      if (form) $('[data-add-button]', form).disabled = true;
    }
  }

  $('[data-retry]', errorState)?.addEventListener('click', load);
  // O limite de quantidade depende do que já está no pedido (ex.: removido na gaveta).
  cart.subscribe(() => { if (product && selection) updateSelectionUI(); });
  setupGallery();
  await load();
}
