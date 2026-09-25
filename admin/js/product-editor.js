// Editor de produto: dados principais, imagens (URL/chave ou upload para o Storage) e variantes.
// Gravação: produto → imagens → variantes (apagar, atualizar, inserir). Falhas parciais são reportadas e
// ficam por gravar no formulário, para que um novo "Guardar" tente apenas o que faltou.
import { SITE_CONFIG } from '/config/site.js';
import { escapeHTML } from '/js/lib/html.js';
import { resolveImage } from '/js/lib/images.js';
import {
  IMAGE_FIELDS, LIMITS, ORDER_MODES, PRODUCT_STATUSES, QUICK_SIZES, VARIANT_FIELDS,
  applyNameChange, applySlugChange, applySyncResult, createKeyFactory, dbErrorMessage, emptyProductForm,
  formSnapshot, generateSizeRows, imageRowsFromDb, isUuid, moveItem, newImageEntry, newVariantEntry,
  planSync, productFormFromDb, productStatusLabel, sizeOptions, storagePathFromPublicUrl, validateImageFile,
  validateImageSource, validateImages, validateProductForm, validateVariants, variantRowsFromDb
} from './logic.js';
import { emptyHTML, loadInto, optionsHTML, productStatusChip, setFieldError } from './ui.js';

const FIELD_NAMES = ['name', 'slug', 'category', 'productType', 'basePrice', 'status', 'orderMode', 'tag', 'description', 'featured'];
const fieldId = name => `product-${name}`;
const quickSizesLabel = `${QUICK_SIZES[0]}–${QUICK_SIZES[QUICK_SIZES.length - 1]}`;

// ─── Templates ───────────────────────────────────────────────────────────────

function describedBy(name, hint) {
  return [hint ? `${fieldId(name)}-hint` : '', `${fieldId(name)}-error`].filter(Boolean).join(' ');
}

function fieldWrap(name, label, control, { hint = '', required = false, full = false } = {}) {
  const id = fieldId(name);
  return `<div class="field${full ? ' field-full' : ''}">
    <label for="${id}">${escapeHTML(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    ${control}
    ${hint ? `<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
    <p class="field-error" id="${id}-error"></p>
  </div>`;
}

function textInput(name, value, { hint = '', required = false, extra = '' } = {}) {
  return `<input id="${fieldId(name)}" name="${name}" type="text" value="${escapeHTML(value)}"${required ? ' required' : ''} aria-describedby="${describedBy(name, hint)}" ${extra}>`;
}

function selectInput(name, options, value, { hint = '', required = false } = {}) {
  return `<select id="${fieldId(name)}" name="${name}"${required ? ' required' : ''} aria-describedby="${describedBy(name, hint)}">${optionsHTML(options, value)}</select>`;
}

function infoHTML(form) {
  const categories = [{ value: '', label: 'Escolhe uma categoria' }, ...SITE_CONFIG.categories.map(category => ({ value: category.id, label: category.label }))];
  const statuses = PRODUCT_STATUSES.map(status => ({ value: status.id, label: status.label }));
  const modes = ORDER_MODES.map(mode => ({ value: mode.id, label: mode.label }));
  const hints = {
    slug: 'Endereço público: <code data-slug-preview></code>. Gerado a partir do nome até o editares.',
    productType: 'Subtítulo no cartão do produto (ex.: Polo, T-shirt).',
    basePrice: 'Número inteiro em meticais (MT). Vazio = sem preço: a loja mostra “Preço sob consulta” e a peça não pode ser encomendada pelo carrinho.',
    status: 'Só produtos ativos aparecem na loja.',
    orderMode: 'Personalização: o cliente fala connosco pelo WhatsApp em vez de usar o carrinho.',
    tag: 'Opcional, aparece no cartão (ex.: SIGNATURE).'
  };
  return `
  <section class="panel" aria-labelledby="editor-info">
    <h2 id="editor-info">Informação</h2>
    <div class="form-grid">
      ${fieldWrap('name', 'Nome', textInput('name', form.name, { required: true, extra: `maxlength="${LIMITS.name}" autocomplete="off"` }), { required: true })}
      ${fieldWrap('slug', 'Slug', textInput('slug', form.slug, { hint: hints.slug, required: true, extra: `maxlength="${LIMITS.slug}" autocomplete="off" autocapitalize="off" spellcheck="false"` }), { hint: hints.slug, required: true })}
      ${fieldWrap('category', 'Categoria', selectInput('category', categories, form.category, { required: true }), { required: true })}
      ${fieldWrap('productType', 'Tipo de produto', textInput('productType', form.productType, { hint: hints.productType, extra: `maxlength="${LIMITS.productType}"` }), { hint: hints.productType })}
      ${fieldWrap('basePrice', 'Preço base (MT)', textInput('basePrice', form.basePrice, { hint: hints.basePrice, extra: 'inputmode="numeric" autocomplete="off" placeholder="Sem preço"' }), { hint: hints.basePrice })}
      ${fieldWrap('status', 'Estado', selectInput('status', statuses, form.status, { hint: hints.status }), { hint: hints.status })}
      ${fieldWrap('orderMode', 'Modo de pedido', selectInput('orderMode', modes, form.orderMode, { hint: hints.orderMode }), { hint: hints.orderMode })}
      ${fieldWrap('tag', 'Etiqueta', textInput('tag', form.tag, { hint: hints.tag, extra: `maxlength="${LIMITS.tag}"` }), { hint: hints.tag })}
      <div class="field field-full field-check">
        <input id="${fieldId('featured')}" name="featured" type="checkbox"${form.featured ? ' checked' : ''} aria-describedby="${fieldId('featured')}-hint ${fieldId('featured')}-error">
        <label for="${fieldId('featured')}">Destaque</label>
        <p class="field-hint" id="${fieldId('featured')}-hint">Aparece no NEW DROP da página inicial.</p>
        <p class="field-error" id="${fieldId('featured')}-error"></p>
      </div>
      ${fieldWrap('description', 'Descrição', `<textarea id="${fieldId('description')}" name="description" rows="5" maxlength="${LIMITS.description}" aria-describedby="${describedBy('description', '')}">${escapeHTML(form.description)}</textarea>`, { full: true })}
    </div>
  </section>`;
}

function previewHTML(src) {
  if (!validateImageSource(src).ok) return '<span class="preview-empty">Sem pré-visualização</span>';
  const image = resolveImage(src);
  const srcset = image.srcset ? ` srcset="${escapeHTML(image.srcset)}" sizes="120px"` : '';
  return `<img src="${escapeHTML(image.src)}"${srcset} alt="" loading="lazy" decoding="async">`;
}

function imageItemHTML(image, index, total) {
  const key = escapeHTML(image.key);
  const errorsId = `img-${key}-errors`;
  return `<li class="image-item" data-key="${key}">
    <div class="image-preview" data-preview>${previewHTML(image.src)}</div>
    <div class="image-body">
      <p class="item-title">Imagem ${index + 1}${index === 0 ? ' · principal' : ''}</p>
      <p class="image-src"><code>${escapeHTML(image.src)}</code></p>
      <div class="image-fields">
        <div class="field">
          <label for="img-${key}-alt">Texto alternativo</label>
          <input id="img-${key}-alt" type="text" data-field="alt" value="${escapeHTML(image.alt)}" maxlength="${LIMITS.alt}" placeholder="Vazio = nome do produto" aria-describedby="${errorsId}">
        </div>
        <div class="field">
          <label for="img-${key}-color">Cor (opcional)</label>
          <input id="img-${key}-color" type="text" data-field="color" value="${escapeHTML(image.color)}" list="admin-colors" maxlength="${LIMITS.color}" placeholder="Todas as cores" aria-describedby="${errorsId}">
        </div>
      </div>
      <ul class="row-errors" id="${errorsId}"></ul>
    </div>
    <div class="item-actions">
      <button type="button" class="btn btn-small" data-action="image-up"${index === 0 ? ' disabled' : ''}><span aria-hidden="true">↑</span> Subir<span class="sr-only"> imagem ${index + 1}</span></button>
      <button type="button" class="btn btn-small" data-action="image-down"${index === total - 1 ? ' disabled' : ''}><span aria-hidden="true">↓</span> Descer<span class="sr-only"> imagem ${index + 1}</span></button>
      <button type="button" class="btn btn-small btn-danger-ghost" data-action="image-remove">Remover<span class="sr-only"> imagem ${index + 1}</span></button>
    </div>
  </li>`;
}

function variantRowHTML(variant, index) {
  const key = escapeHTML(variant.key);
  const id = field => `var-${key}-${field}`;
  const errorsId = `var-${key}-errors`;
  const input = (field, label, value, extra = '') => `<div class="field">
      <label for="${id(field)}">${label}</label>
      <input id="${id(field)}" type="text" data-field="${field}" value="${escapeHTML(value)}" aria-describedby="${errorsId}" ${extra}>
    </div>`;
  return `<div class="variant-row" role="group" aria-labelledby="var-${key}-title" data-key="${key}">
    <p class="item-title" id="var-${key}-title">Variante ${index + 1}</p>
    <div class="variant-fields">
      ${input('color', 'Cor', variant.color, `list="admin-colors" maxlength="${LIMITS.color}" autocomplete="off"`)}
      <div class="field">
        <label for="${id('size')}">Tamanho</label>
        <select id="${id('size')}" data-field="size" aria-describedby="${errorsId}">${optionsHTML(sizeOptions(variant.size), variant.size)}</select>
      </div>
      ${input('stock', 'Stock', variant.stock, 'inputmode="numeric" autocomplete="off" placeholder="Por definir"')}
      ${input('priceOverride', 'Preço (MT)', variant.priceOverride, 'inputmode="numeric" autocomplete="off" placeholder="Preço base"')}
      ${input('sku', 'SKU', variant.sku, `maxlength="${LIMITS.sku}" autocomplete="off" spellcheck="false"`)}
      <div class="variant-remove">
        <button type="button" class="btn btn-small btn-danger-ghost" data-action="variant-remove">Remover<span class="sr-only"> variante ${index + 1}</span></button>
      </div>
    </div>
    <ul class="row-errors" id="${errorsId}"></ul>
  </div>`;
}

function editorHTML(form) {
  const colors = [...new Set([...Object.keys(SITE_CONFIG.colorSwatches), ...form.variants.map(variant => variant.color).filter(Boolean)])];
  return `
  <form class="editor" novalidate data-editor>
    ${infoHTML(form)}

    <section class="panel" aria-labelledby="editor-images">
      <h2 id="editor-images">Imagens</h2>
      <p class="hint">A primeira imagem é a principal. Associa uma cor para a mostrar quando o cliente escolhe essa cor.</p>
      <div data-images></div>
      <div class="add-grid">
        <div class="field">
          <label for="image-url">Adicionar por URL ou chave de imagem do site</label>
          <div class="inline-control">
            <input id="image-url" type="text" autocomplete="off" spellcheck="false" placeholder="https://… ou tee-verde-modelo" aria-describedby="image-url-error">
            <button type="button" class="btn" data-action="image-add-url">Adicionar</button>
          </div>
          <p class="field-error" id="image-url-error"></p>
        </div>
        <div class="field">
          <label for="image-file">Carregar ficheiro (JPG, PNG ou WebP, até 5 MB)</label>
          <input id="image-file" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="image-file-status image-file-error">
          <p class="field-hint" id="image-file-status" role="status"></p>
          <p class="field-error" id="image-file-error"></p>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="editor-variants">
      <h2 id="editor-variants">Variantes</h2>
      <p class="hint">Cada linha é uma combinação de cor e tamanho. Stock vazio = por definir (a peça não pode ser encomendada). Preço vazio = usa o preço base.</p>
      <div data-variants></div>
      <div class="add-grid">
        <div class="field">
          <span class="field-label" aria-hidden="true">Nova linha</span>
          <button type="button" class="btn" data-action="variant-add">+ Adicionar variante</button>
        </div>
        <div class="field">
          <label for="generate-color">Gerar tamanhos ${quickSizesLabel} para a cor</label>
          <div class="inline-control">
            <input id="generate-color" type="text" list="admin-colors" autocomplete="off" placeholder="ex.: Preto" aria-describedby="generate-error">
            <button type="button" class="btn" data-action="variant-generate">Gerar tamanhos</button>
          </div>
          <p class="field-error" id="generate-error"></p>
        </div>
      </div>
      <datalist id="admin-colors">${colors.map(color => `<option value="${escapeHTML(color)}"></option>`).join('')}</datalist>
    </section>

    <div class="actionbar">
      <div class="actionbar-messages">
        <p class="form-status" role="status" data-status></p>
        <p class="form-status form-status-error" role="alert" data-alert></p>
      </div>
      <div class="actionbar-buttons" data-actions></div>
    </div>
  </form>`;
}

// ─── Vista ───────────────────────────────────────────────────────────────────

export function renderProductEditor(ctx) {
  const isNew = ctx.route.name === 'product-new';
  ctx.setTitle(isNew ? 'Novo produto' : 'Editar produto');
  ctx.main.innerHTML = `
    <div class="page-head">
      <div>
        <a class="back-link" href="#/produtos">← Produtos</a>
        <p class="page-kicker" data-kicker>${isNew ? 'Novo produto' : 'Editar produto'}</p>
        <h1 tabindex="-1" data-title>${isNew ? 'Novo produto' : 'Produto'}</h1>
      </div>
      <div data-head-status></div>
    </div>
    <div data-region></div>`;
  const region = ctx.main.querySelector('[data-region]');
  const makeKey = createKeyFactory('r');

  if (isNew) {
    mountEditor(ctx, region, emptyProductForm(), { images: [], variants: [] }, makeKey);
    return;
  }
  const notFound = () => { region.innerHTML = emptyHTML('Produto não encontrado.', '<p><a class="btn" href="#/produtos">Voltar aos produtos</a></p>'); };
  if (!isUuid(ctx.route.id)) {
    notFound();
    return;
  }
  loadInto(region, {
    load: () => ctx.api.getProduct(ctx.route.id),
    isAlive: ctx.alive,
    loadingText: 'A carregar produto…',
    errorMessage: error => `Não foi possível carregar o produto. ${dbErrorMessage(error)}`,
    render: row => {
      if (!row) return notFound();
      mountEditor(ctx, region, productFormFromDb(row, makeKey), {
        images: imageRowsFromDb(row.product_images),
        variants: variantRowsFromDb(row.product_variants)
      }, makeKey, row.status);
    }
  });
}

function mountEditor(ctx, region, form, original, makeKey, savedStatus = null) {
  const state = {
    form,
    original,
    saved: formSnapshot(form),
    savedStatus,
    saving: false,
    uploads: 0,
    showErrors: false,
    deleted: false,
    sessionUploads: new Set()
  };
  ctx.setGuard(() => !state.deleted && (state.uploads > 0 || formSnapshot(state.form) !== state.saved));

  region.innerHTML = editorHTML(form);
  const formEl = region.querySelector('[data-editor]');
  const imagesEl = formEl.querySelector('[data-images]');
  const variantsEl = formEl.querySelector('[data-variants]');
  const statusEl = formEl.querySelector('[data-status]');
  const alertEl = formEl.querySelector('[data-alert]');
  const actionsEl = formEl.querySelector('[data-actions]');
  const slugPreview = formEl.querySelector('[data-slug-preview]');
  const urlInput = formEl.querySelector('#image-url');
  const urlError = formEl.querySelector('#image-url-error');
  const fileInput = formEl.querySelector('#image-file');
  const fileStatus = formEl.querySelector('#image-file-status');
  const fileError = formEl.querySelector('#image-file-error');
  const generateInput = formEl.querySelector('#generate-color');
  const generateError = formEl.querySelector('#generate-error');
  const titleEl = ctx.main.querySelector('[data-title]');
  const kickerEl = ctx.main.querySelector('[data-kicker]');
  const headStatus = ctx.main.querySelector('[data-head-status]');
  const control = name => formEl.querySelector(`#${fieldId(name)}`);
  const byKey = (container, key) => container.querySelector(`[data-key="${CSS.escape(key)}"]`);

  // ── Pintura ──

  function setStatus(message, type = 'info') {
    statusEl.textContent = type === 'error' ? '' : message;
    statusEl.className = `form-status${type === 'success' ? ' form-status-success' : ''}`;
    alertEl.textContent = type === 'error' ? message : '';
  }

  function paintHeader() {
    const isNewNow = state.form.isNew;
    titleEl.textContent = isNewNow ? 'Novo produto' : (state.form.name.trim() || 'Produto sem nome');
    kickerEl.textContent = isNewNow ? 'Novo produto' : 'Editar produto';
    headStatus.innerHTML = state.savedStatus ? productStatusChip(state.savedStatus) : '';
    ctx.setTitle(isNewNow ? 'Novo produto' : `Editar: ${state.form.name.trim() || 'produto'}`);
  }

  function paintActions() {
    const busy = state.saving;
    const disabled = busy ? ' disabled' : '';
    actionsEl.innerHTML = state.form.isNew
      ? `<a class="btn" href="#/produtos">Cancelar</a>
         <button type="submit" class="btn btn-primary"${disabled}>${busy ? 'A guardar…' : 'Guardar'}</button>`
      : `<button type="button" class="btn btn-danger-ghost" data-action="delete"${disabled}>Apagar</button>
         ${state.savedStatus !== 'archived' ? `<button type="button" class="btn" data-action="archive"${disabled}>Arquivar</button>` : ''}
         <button type="submit" class="btn btn-primary"${disabled}>${busy ? 'A guardar…' : 'Guardar'}</button>`;
    formEl.setAttribute('aria-busy', String(busy));
  }

  function paintSlugPreview() {
    slugPreview.textContent = `/produtos/${state.form.slug.trim() || '…'}`;
  }

  function paintImages() {
    const { images } = state.form;
    imagesEl.innerHTML = images.length
      ? `<ol class="image-list">${images.map((image, index) => imageItemHTML(image, index, images.length)).join('')}</ol>`
      : '<p class="empty-inline">Sem imagens. Adiciona pelo menos uma para o produto ficar bem apresentado na loja.</p>';
    if (state.showErrors) paintErrors(validateAll());
  }

  function paintVariants() {
    const { variants } = state.form;
    variantsEl.innerHTML = variants.length
      ? `<div class="variant-list">${variants.map(variantRowHTML).join('')}</div>`
      : '<p class="empty-inline">Sem variantes. Sem variantes com stock e preço o produto não pode ser encomendado pelo carrinho.</p>';
    if (state.showErrors) paintErrors(validateAll());
  }

  function validateAll() {
    const product = validateProductForm(state.form);
    return {
      product,
      images: validateImages(state.form.images, product.value.name),
      variants: validateVariants(state.form.variants)
    };
  }

  function paintRowErrors(container, list, errors) {
    list.forEach((entry, index) => {
      const element = byKey(container, entry.key);
      if (!element) return;
      const mine = errors.filter(error => error.index === index);
      element.classList.toggle('has-error', mine.length > 0);
      element.querySelector('.row-errors').innerHTML = mine.map(error => `<li>${escapeHTML(error.message)}</li>`).join('');
      for (const input of element.querySelectorAll('[data-field]')) {
        if (mine.some(error => error.field === input.dataset.field)) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    });
  }

  function paintErrors({ product, images, variants }) {
    for (const name of FIELD_NAMES) setFieldError(control(name), formEl.querySelector(`#${fieldId(name)}-error`), product.errors[name]);
    paintRowErrors(imagesEl, state.form.images, images.errors);
    paintRowErrors(variantsEl, state.form.variants, variants.errors);
  }

  function focusFirstInvalid() {
    const target = formEl.querySelector('[aria-invalid="true"]') ?? formEl.querySelector('.has-error button');
    target?.focus();
  }

  // ── Edição ──

  function updateEntry(list, key, field, value) {
    state.form = { ...state.form, [list]: state.form[list].map(entry => (entry.key === key ? { ...entry, [field]: value } : entry)) };
  }

  function onFieldInput(event) {
    const target = event.target;
    if (target.type === 'file') return;
    const item = target.closest('[data-key]');
    if (item && target.dataset.field) {
      const list = imagesEl.contains(item) ? 'images' : 'variants';
      updateEntry(list, item.dataset.key, target.dataset.field, target.value);
    } else if (FIELD_NAMES.includes(target.name)) {
      if (target.name === 'name') {
        state.form = applyNameChange(state.form, target.value);
        control('slug').value = state.form.slug;
        paintSlugPreview();
      } else if (target.name === 'slug') {
        state.form = applySlugChange(state.form, target.value);
        paintSlugPreview();
      } else {
        state.form = { ...state.form, [target.name]: target.type === 'checkbox' ? target.checked : target.value };
      }
    } else {
      return;
    }
    if (state.showErrors) paintErrors(validateAll());
  }

  function moveImage(key, delta) {
    const index = state.form.images.findIndex(image => image.key === key);
    const moved = moveItem(state.form.images, index, delta);
    if (moved === state.form.images) return;
    state.form = { ...state.form, images: moved };
    paintImages();
    const item = byKey(imagesEl, key);
    const [same, other] = delta < 0 ? ['image-up', 'image-down'] : ['image-down', 'image-up'];
    const button = item.querySelector(`[data-action="${same}"]`);
    (button.disabled ? item.querySelector(`[data-action="${other}"]`) : button).focus();
    setStatus(`Imagem movida para a posição ${index + delta + 1}.`);
  }

  function removeImage(key) {
    const index = state.form.images.findIndex(image => image.key === key);
    state.form = { ...state.form, images: state.form.images.filter(image => image.key !== key) };
    paintImages();
    const next = state.form.images[Math.min(index, state.form.images.length - 1)];
    (next ? byKey(imagesEl, next.key).querySelector('[data-action="image-remove"]') : urlInput).focus();
    setStatus('Imagem removida. Guarda para confirmar.');
  }

  function addImageFromUrl() {
    const source = validateImageSource(urlInput.value);
    if (source.ok && state.form.images.some(image => image.src.trim() === source.value)) {
      setFieldError(urlInput, urlError, 'Esta imagem já está na lista.');
      urlInput.focus();
      return;
    }
    setFieldError(urlInput, urlError, source.ok ? '' : source.error);
    if (!source.ok) {
      urlInput.focus();
      return;
    }
    state.form = { ...state.form, images: [...state.form.images, newImageEntry(makeKey(), { src: source.value })] };
    urlInput.value = '';
    paintImages();
    setStatus(`Imagem adicionada na posição ${state.form.images.length}. Guarda para confirmar.`);
    urlInput.focus();
  }

  async function uploadFiles(files) {
    setFieldError(fileInput, fileError, '');
    const problems = [];
    for (const file of files) {
      const check = validateImageFile(file);
      if (!check.ok) {
        problems.push(`${file.name}: ${check.error}`);
        continue;
      }
      state.uploads += 1;
      fileStatus.textContent = `A carregar “${file.name}”…`;
      try {
        const { url } = await ctx.api.uploadImage(state.form.id, file);
        if (!ctx.alive()) return;
        state.sessionUploads.add(url);
        state.form = { ...state.form, images: [...state.form.images, newImageEntry(makeKey(), { src: url })] };
        paintImages();
      } catch (error) {
        console.error(error);
        problems.push(`${file.name}: ${dbErrorMessage(error)}`);
      } finally {
        state.uploads -= 1;
      }
    }
    if (!ctx.alive()) return;
    const uploaded = files.length - problems.length;
    fileStatus.textContent = uploaded ? `${uploaded === 1 ? 'Imagem carregada' : `${uploaded} imagens carregadas`}. Guarda o produto para as associar.` : '';
    setFieldError(fileInput, fileError, problems.length ? `Não foi possível carregar: ${problems.join(' · ')}` : '');
  }

  function addVariant() {
    const last = state.form.variants[state.form.variants.length - 1];
    const entry = newVariantEntry(makeKey(), { color: last?.color ?? '' });
    state.form = { ...state.form, variants: [...state.form.variants, entry] };
    paintVariants();
    byKey(variantsEl, entry.key).querySelector(last?.color ? '[data-field="size"]' : '[data-field="color"]').focus();
    setStatus(`Variante ${state.form.variants.length} adicionada.`);
  }

  function removeVariant(key) {
    const index = state.form.variants.findIndex(variant => variant.key === key);
    state.form = { ...state.form, variants: state.form.variants.filter(variant => variant.key !== key) };
    paintVariants();
    const next = state.form.variants[Math.min(index, state.form.variants.length - 1)];
    (next ? byKey(variantsEl, next.key).querySelector('[data-action="variant-remove"]') : formEl.querySelector('[data-action="variant-add"]')).focus();
    setStatus('Variante removida. Guarda para confirmar.');
  }

  function generateSizes() {
    const color = generateInput.value.trim();
    if (!color) {
      setFieldError(generateInput, generateError, 'Indica a cor.');
      generateInput.focus();
      return;
    }
    const rows = generateSizeRows(state.form.variants, color, makeKey);
    if (!rows.length) {
      setFieldError(generateInput, generateError, `A cor “${color}” já tem todos os tamanhos ${quickSizesLabel}.`);
      generateInput.focus();
      return;
    }
    setFieldError(generateInput, generateError, '');
    state.form = { ...state.form, variants: [...state.form.variants, ...rows] };
    generateInput.value = '';
    paintVariants();
    byKey(variantsEl, rows[0].key).querySelector('[data-field="stock"]').focus();
    setStatus(`${rows.length === 1 ? '1 variante adicionada' : `${rows.length} variantes adicionadas`} para ${color} (${rows.map(row => row.size).join(', ')}).`);
  }

  // ── Gravação ──

  function failureSummary(failures, singular, plural) {
    if (!failures.length) return '';
    const count = failures.reduce((sum, failure) => sum + (failure.count ?? 1), 0);
    const reasons = [...new Set(failures.map(failure => dbErrorMessage(failure.error)))].join(' ');
    return `${count} ${count === 1 ? singular : plural}: ${reasons}`;
  }

  async function cleanupStorage(removedUrls) {
    const inUse = new Set(state.form.images.map(image => image.src.trim()));
    const orphanUploads = [...state.sessionUploads].filter(url => !inUse.has(url));
    const folder = `products/${state.form.id}/`;
    const urls = [...new Set([...removedUrls, ...orphanUploads])].filter(url => !inUse.has(url));
    const paths = urls.map(url => storagePathFromPublicUrl(url, ctx.supabaseUrl)).filter(path => path?.startsWith(folder));
    if (!paths.length) return '';
    try {
      await ctx.api.removeStorageObjects(paths);
      for (const url of urls) state.sessionUploads.delete(url);
      return '';
    } catch (error) {
      console.warn('Limpeza do Storage falhou', error);
      return ` Nota: ${paths.length === 1 ? 'um ficheiro de imagem removido continua' : `${paths.length} ficheiros de imagem removidos continuam`} no Storage.`;
    }
  }

  async function save() {
    if (state.saving) return;
    if (state.uploads) {
      setStatus('Aguarda que o carregamento das imagens termine.', 'error');
      return;
    }
    const results = validateAll();
    state.showErrors = true;
    paintErrors(results);
    const errorCount = Object.keys(results.product.errors).length + results.images.errors.length + results.variants.errors.length;
    if (errorCount) {
      setStatus(`Não foi guardado: corrige ${errorCount === 1 ? 'o campo assinalado' : `os ${errorCount} campos assinalados`}.`, 'error');
      focusFirstInvalid();
      return;
    }

    const snapshot = formSnapshot(state.form);
    const productId = state.form.id;
    const wasNew = state.form.isNew;
    state.saving = true;
    paintActions();
    setStatus('A guardar…');

    try {
      if (wasNew) await ctx.api.insertProduct({ id: productId, ...results.product.value });
      else await ctx.api.updateProduct(productId, results.product.value);
    } catch (error) {
      console.error(error);
      state.saving = false;
      paintActions();
      const message = dbErrorMessage(error);
      if (error?.code === '23505' && /slug/i.test(`${error.message} ${error.details}`)) setFieldError(control('slug'), formEl.querySelector(`#${fieldId('slug')}-error`), message);
      setStatus(`Não foi possível guardar o produto. ${message}`, 'error');
      return;
    }
    if (!ctx.alive()) return;

    state.savedStatus = results.product.value.status;
    if (wasNew) {
      state.form = { ...state.form, isNew: false };
      ctx.replaceRoute(`#/produtos/${encodeURIComponent(productId)}`);
    }

    const problems = [];
    // Imagens
    const imageRowsBefore = state.original.images;
    const imageResult = await ctx.api.syncRows('product_images', productId, planSync(imageRowsBefore, results.images.rows, IMAGE_FIELDS));
    if (!ctx.alive()) return;
    const imagesApplied = applySyncResult(imageRowsBefore, state.form.images, imageResult);
    state.original = { ...state.original, images: imagesApplied.original };
    state.form = { ...state.form, images: imagesApplied.rows };
    const imageProblem = failureSummary(imageResult.failures, 'imagem não foi gravada', 'imagens não foram gravadas');
    if (imageProblem) problems.push(imageProblem);

    // Variantes
    const variantResult = await ctx.api.syncRows('product_variants', productId, planSync(state.original.variants, results.variants.rows, VARIANT_FIELDS));
    if (!ctx.alive()) return;
    const variantsApplied = applySyncResult(state.original.variants, state.form.variants, variantResult);
    state.original = { ...state.original, variants: variantsApplied.original };
    state.form = { ...state.form, variants: variantsApplied.rows };
    const variantProblem = failureSummary(variantResult.failures, 'variante não foi gravada', 'variantes não foram gravadas');
    if (variantProblem) problems.push(variantProblem);

    const removedUrls = imageResult.deleted.map(id => imageRowsBefore.find(row => row.id === id)?.image_url).filter(Boolean);
    const storageNote = await cleanupStorage(removedUrls);
    if (!ctx.alive()) return;

    state.saving = false;
    paintActions();
    paintHeader();
    if (!problems.length) {
      state.saved = snapshot;
      setStatus(`${wasNew ? 'Produto criado' : 'Alterações guardadas'} (${productStatusLabel(state.savedStatus)}).${storageNote}`, 'success');
    } else {
      setStatus(`${wasNew ? 'Produto criado' : 'Produto guardado'}, mas ${problems.join(' ')} O que falhou continua no formulário: revê e carrega em Guardar para tentar de novo.${storageNote}`, 'error');
    }
  }

  function archive() {
    state.form = { ...state.form, status: 'archived' };
    control('status').value = 'archived';
    save();
  }

  async function removeProduct() {
    const name = state.form.name.trim() || 'este produto';
    const confirmed = window.confirm(
      `Apagar definitivamente “${name}”?\n\n`
      + 'As imagens e variantes deste produto também serão apagadas. O histórico de pedidos mantém-se: '
      + 'cada pedido guarda uma cópia do nome, cor, tamanho e preço no momento da compra.\n\n'
      + 'Se só queres retirá-lo da loja, usa “Arquivar”.'
    );
    if (!confirmed) return;
    state.saving = true;
    paintActions();
    setStatus('A apagar…');
    try {
      await ctx.api.deleteProduct(state.form.id);
    } catch (error) {
      console.error(error);
      state.saving = false;
      paintActions();
      setStatus(`Não foi possível apagar o produto. ${dbErrorMessage(error)}`, 'error');
      return;
    }
    let message = `Produto “${name}” apagado.`;
    try {
      await ctx.api.removeProductFolder(state.form.id);
    } catch (error) {
      console.warn('Limpeza do Storage falhou', error);
      message += ' Os ficheiros de imagem no Storage não foram removidos (podes apagá-los no painel do Supabase).';
    }
    state.deleted = true;
    ctx.setGuard(null);
    ctx.navigate('#/produtos', [message, 'success']);
  }

  // ── Eventos ──

  formEl.addEventListener('input', onFieldInput);
  formEl.addEventListener('change', event => {
    if (event.target === fileInput) {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (files.length) uploadFiles(files);
      return;
    }
    onFieldInput(event);
  });
  formEl.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.target === urlInput) {
      event.preventDefault();
      addImageFromUrl();
    } else if (event.target === generateInput) {
      event.preventDefault();
      generateSizes();
    }
  });
  formEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const key = button.closest('[data-key]')?.dataset.key;
    const actions = {
      'image-up': () => moveImage(key, -1),
      'image-down': () => moveImage(key, 1),
      'image-remove': () => removeImage(key),
      'image-add-url': addImageFromUrl,
      'variant-add': addVariant,
      'variant-remove': () => removeVariant(key),
      'variant-generate': generateSizes,
      archive,
      delete: removeProduct
    };
    actions[button.dataset.action]?.();
  });
  formEl.addEventListener('submit', event => {
    event.preventDefault();
    save();
  });
  // Pré-visualizações que falham (URL inválido, ficheiro inexistente).
  imagesEl.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    event.target.closest('[data-preview]').innerHTML = '<span class="preview-empty">Não foi possível mostrar a imagem</span>';
  }, true);

  paintHeader();
  paintActions();
  paintSlugPreview();
  paintImages();
  paintVariants();
}
