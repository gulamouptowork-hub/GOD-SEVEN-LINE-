import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_FIELDS, ORDERS_PAGE_SIZE, QUICK_SIZES, VARIANT_FIELDS,
  applyNameChange, applySlugChange, applySyncResult, authErrorMessage, buildStockGroups, collectStockEdits,
  compareSizes, createKeyFactory, customerWhatsAppURL, dbErrorMessage, emptyProductForm, filterProductRows,
  filterStockGroups, formSnapshot, generateSizeRows, isUuid, moveItem, newVariantEntry, orderDetailFromDb,
  orderItemCount, orderListRow, orderSearchFilter, parseRoute, parseWholeNumber, planSync, productDeleteConfirmation, productFormFromDb,
  productListRow, sizeOptions, stepStock, stockStatus, stockStatusLabel, stockSummaryLabel,
  storagePathFromPublicUrl, summarizeVariantStock, totalStock, uploadPath, uuid, validateImageFile,
  validateImageSource, validateImages, validateProductForm, validateVariants, variantRowsFromDb
} from '../admin/js/logic.js';

const PRODUCT_ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

const productRow = () => ({
  id: PRODUCT_ID,
  slug: 'polo-seven',
  name: 'Polo Seven',
  description: 'Polo com identidade Seven.',
  category: 'polos',
  product_type: 'Polo',
  base_price: 1250,
  status: 'active',
  featured: true,
  order_mode: 'cart',
  tag: 'IDENTIDADE',
  product_images: [
    { id: 'img-2', image_url: 'polos-grupo', alt_text: 'Grupo', position: 1, color: null },
    { id: 'img-1', image_url: 'polos-rosa-vermelho', alt_text: 'Rosa e vermelho', position: 0, color: 'Rosa' }
  ],
  product_variants: [
    { id: 'v-m', color: 'Rosa', size: 'M', stock: 4, price_override: null, sku: null, position: 1 },
    { id: 'v-s', color: 'Rosa', size: 'S', stock: null, price_override: 1400, sku: 'PS-R-S', position: 0 }
  ]
});

// ─── Rotas ───────────────────────────────────────────────────────────────────

test('parseRoute reconhece todas as rotas do painel', () => {
  assert.equal(parseRoute('').name, 'dashboard');
  assert.equal(parseRoute('#/').name, 'dashboard');
  assert.equal(parseRoute('#/produtos').name, 'products');
  assert.equal(parseRoute('#/produtos/').name, 'products');
  assert.equal(parseRoute('#/produtos/novo').name, 'product-new');
  assert.deepEqual({ ...parseRoute(`#/produtos/${PRODUCT_ID}`), query: undefined }, { name: 'product-edit', section: 'produtos', id: PRODUCT_ID, query: undefined });
  assert.equal(parseRoute('#/stock').name, 'stock');
  assert.equal(parseRoute('#/pedidos').name, 'orders');
  assert.equal(parseRoute('#/pedidos/abc').id, 'abc');
  assert.equal(parseRoute('#/pedidos/abc').section, 'pedidos');
  assert.equal(parseRoute('#/nada').name, 'not-found');
  assert.equal(parseRoute('#/stock/extra').name, 'not-found');
  assert.equal(parseRoute('#/produtos/a/b').name, 'not-found');
});

test('parseRoute lê parâmetros opcionais', () => {
  assert.equal(parseRoute('#/pedidos?estado=novo').query.estado, 'novo');
  assert.equal(parseRoute('#/stock?filtro=low').query.filtro, 'low');
  assert.equal(parseRoute('#/stock?filtro=low').name, 'stock');
});

test('isUuid e uuid', () => {
  assert.ok(isUuid(PRODUCT_ID));
  assert.ok(!isUuid('polo-seven'));
  assert.ok(isUuid(uuid()));
  // Alternativa sem randomUUID (contextos não seguros).
  const fallback = uuid({ getRandomValues: bytes => bytes.fill(0xab) });
  assert.ok(isUuid(fallback));
  assert.equal(fallback[14], '4');
});

// ─── Números e stock ─────────────────────────────────────────────────────────

test('parseWholeNumber aceita inteiros >= 0 e vazio', () => {
  assert.deepEqual(parseWholeNumber(''), { ok: true, value: null });
  assert.deepEqual(parseWholeNumber('   '), { ok: true, value: null });
  assert.deepEqual(parseWholeNumber(null), { ok: true, value: null });
  assert.deepEqual(parseWholeNumber('0'), { ok: true, value: 0 });
  assert.deepEqual(parseWholeNumber(' 1250 '), { ok: true, value: 1250 });
  assert.deepEqual(parseWholeNumber('1.250'), { ok: true, value: 1250 });
  assert.deepEqual(parseWholeNumber('1 250'), { ok: true, value: 1250 });
  assert.deepEqual(parseWholeNumber('1.250.000'), { ok: true, value: 1250000 });
});

test('parseWholeNumber rejeita negativos, decimais e texto', () => {
  assert.equal(parseWholeNumber('-1').error, 'Não pode ser negativo.');
  assert.equal(parseWholeNumber('12,5').error, 'Usa um número inteiro, sem casas decimais.');
  assert.equal(parseWholeNumber('1.5').error, 'Usa um número inteiro, sem casas decimais.');
  assert.equal(parseWholeNumber('abc').ok, false);
  assert.equal(parseWholeNumber('12a').ok, false);
  assert.equal(parseWholeNumber('99999999999').ok, false);
});

test('stockStatus usa o limite de stock baixo da configuração', () => {
  assert.equal(stockStatus(null), 'unknown');
  assert.equal(stockStatus(undefined), 'unknown');
  assert.equal(stockStatus(0), 'out');
  assert.equal(stockStatus(1), 'low');
  assert.equal(stockStatus(3), 'low');
  assert.equal(stockStatus(4), 'in');
  assert.equal(stockStatus(4, 5), 'low');
  assert.equal(stockStatusLabel('in'), 'EM STOCK');
  assert.equal(stockStatusLabel('low'), 'STOCK BAIXO');
  assert.equal(stockStatusLabel('out'), 'ESGOTADO');
  assert.equal(stockStatusLabel('unknown'), 'POR DEFINIR');
});

test('totalStock, stockSummaryLabel e summarizeVariantStock', () => {
  assert.deepEqual(totalStock([{ stock: 2 }, { stock: null }, { stock: 5 }]), { total: 7, known: 2, unknown: 1, count: 3 });
  assert.equal(stockSummaryLabel(totalStock([])), 'Sem variantes');
  assert.equal(stockSummaryLabel(totalStock([{ stock: null }])), 'Por definir');
  assert.equal(stockSummaryLabel(totalStock([{ stock: 2 }, { stock: 3 }])), '5');
  assert.equal(stockSummaryLabel(totalStock([{ stock: 2 }, { stock: null }])), '2 (+1 por definir)');
  assert.deepEqual(summarizeVariantStock([{ stock: 0 }, { stock: 2 }, { stock: 10 }, { stock: null }, { stock: 3 }]), { in: 1, low: 2, out: 1, unknown: 1, total: 5 });
});

test('stepStock nunca desce abaixo de 0', () => {
  assert.equal(stepStock('5', 1), 6);
  assert.equal(stepStock('5', -1), 4);
  assert.equal(stepStock('0', -1), 0);
  assert.equal(stepStock('', 1), 1);
  assert.equal(stepStock('', -1), 0);
  assert.equal(stepStock('abc', 1), 1);
});

test('collectStockEdits devolve só alterações reais e sinaliza inválidos', () => {
  const original = { a: 5, b: null, c: 0 };
  const edits = collectStockEdits(original, { a: '5', b: '3', c: '-2', ghost: '4' });
  assert.deepEqual(edits.changes, [{ id: 'b', stock: 3 }]);
  assert.deepEqual(edits.invalid, [{ id: 'c', error: 'Não pode ser negativo.' }]);
  assert.equal(edits.dirty, true);
  assert.deepEqual(collectStockEdits(original, { a: '05' }), { changes: [], invalid: [], dirty: false });
  assert.deepEqual(collectStockEdits(original, { a: '' }).changes, [{ id: 'a', stock: null }]);
});

test('buildStockGroups agrupa por produto → cor e ordena tamanhos', () => {
  const groups = buildStockGroups([
    productRow(),
    { id: 'empty', name: 'Sem variantes', status: 'draft', product_variants: [] },
    {
      id: 'tee', name: 'Tee', status: 'draft', product_variants: [
        { id: 't-xl', color: 'Preto', size: 'XL', stock: 0, position: 0 },
        { id: 't-38', color: 'Preto', size: '38', stock: 1, position: 1 },
        { id: 't-s', color: 'Preto', size: 'S', stock: 9, position: 2 },
        { id: 't-u', color: 'Verde', size: null, stock: null, position: 3 }
      ]
    }
  ]);
  assert.equal(groups.length, 2, 'produtos sem variantes ficam de fora');
  assert.deepEqual(groups[0].colors.map(color => color.color), ['Rosa']);
  assert.deepEqual(groups[0].colors[0].variants.map(variant => variant.size), ['S', 'M']);
  assert.deepEqual(groups[1].colors[0].variants.map(variant => variant.size), ['S', 'XL', '38']);
  assert.deepEqual(groups[1].colors[1].variants, [{ id: 't-u', size: null, stock: null }]);
  assert.ok(compareSizes(null, 'XS') < 0);
});

test('filterStockGroups filtra por estado e pesquisa (com valores editados)', () => {
  const groups = buildStockGroups([productRow()]);
  assert.equal(filterStockGroups(groups, { filter: 'all' }).length, 1);
  assert.deepEqual(filterStockGroups(groups, { filter: 'unknown' })[0].colors[0].variants.map(variant => variant.id), ['v-s']);
  assert.equal(filterStockGroups(groups, { filter: 'out' }).length, 0);
  assert.equal(filterStockGroups(groups, { filter: 'out' }, variant => (variant.id === 'v-m' ? 0 : variant.stock)).length, 1);
  assert.equal(filterStockGroups(groups, { q: 'rosa polo' }).length, 1);
  assert.equal(filterStockGroups(groups, { q: 'verde' }).length, 0);
});

// ─── Produtos ────────────────────────────────────────────────────────────────

test('productListRow mapeia a linha para a tabela', () => {
  const row = productListRow(productRow());
  assert.equal(row.priceLabel, '1.250 MT');
  assert.equal(row.categoryLabel, 'Polos');
  assert.equal(row.statusLabel, 'Ativo');
  assert.equal(row.thumb, 'polos-rosa-vermelho', 'miniatura = imagem na posição 0');
  assert.equal(row.stockLabel, '4 (+1 por definir)');
  const noPrice = productListRow({ ...productRow(), base_price: null, status: 'draft', product_images: [] });
  assert.equal(noPrice.priceLabel, 'Sem preço');
  assert.equal(noPrice.statusLabel, 'Rascunho');
  assert.equal(noPrice.thumb, null);
});

test('filterProductRows combina pesquisa, categoria e estado', () => {
  const rows = [
    productListRow(productRow()),
    productListRow({ ...productRow(), id: '2', name: 'T-shirt Seven', slug: 't-shirt-seven', category: 't-shirts', product_type: 'T-shirt', status: 'draft', tag: null })
  ];
  assert.equal(filterProductRows(rows, { q: 'seven' }).length, 2);
  assert.equal(filterProductRows(rows, { q: 'polo' }).length, 1);
  assert.equal(filterProductRows(rows, { category: 't-shirts' })[0].slug, 't-shirt-seven');
  assert.equal(filterProductRows(rows, { status: 'active' }).length, 1);
  assert.equal(filterProductRows(rows, { q: 'personalização' }).length, 0);
});

test('productDeleteConfirmation nomeia o produto e avisa o que se mantém', () => {
  const text = productDeleteConfirmation('  Polo Seven ');
  assert.match(text, /^Apagar definitivamente “Polo Seven”\?/);
  assert.match(text, /imagens e variantes/);
  assert.match(text, /histórico de pedidos mantém-se/);
  assert.match(text, /Arquivar/);
  assert.match(productDeleteConfirmation(''), /“este produto”/);
  assert.match(productDeleteConfirmation(null), /“este produto”/);
});

test('slug é gerado do nome até ser editado à mão', () => {
  let form = emptyProductForm(PRODUCT_ID);
  form = applyNameChange(form, 'Polo Açaí Édição');
  assert.equal(form.slug, 'polo-acai-edicao');
  form = applySlugChange(form, 'meu-slug');
  form = applyNameChange(form, 'Outro nome');
  assert.equal(form.slug, 'meu-slug');
  form = applySlugChange(form, '');
  form = applyNameChange(form, 'Novo Nome');
  assert.equal(form.slug, 'novo-nome', 'apagar o slug volta a gerá-lo automaticamente');
  const existing = productFormFromDb(productRow());
  assert.equal(applyNameChange(existing, 'Polo Renomeado').slug, 'polo-seven', 'produtos existentes mantêm o slug');
});

test('productFormFromDb converte para texto e ordena por posição', () => {
  const form = productFormFromDb(productRow(), createKeyFactory('t'));
  assert.equal(form.basePrice, '1250');
  assert.equal(form.productType, 'Polo');
  assert.equal(form.isNew, false);
  assert.deepEqual(form.images.map(image => image.id), ['img-1', 'img-2']);
  assert.deepEqual(form.variants.map(variant => [variant.id, variant.size, variant.stock, variant.priceOverride]), [
    ['v-s', 'S', '', '1400'], ['v-m', 'M', '4', '']
  ]);
  assert.deepEqual(form.images.map(image => image.key), ['t1', 't2']);
});

test('validateProductForm valida campos e devolve a linha snake_case', () => {
  const ok = validateProductForm({ ...emptyProductForm(PRODUCT_ID), name: '  Polo  Seven ', slug: 'polo-seven', category: 'polos', basePrice: '1.250', tag: ' ' });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.value, {
    name: 'Polo Seven', slug: 'polo-seven', category: 'polos', product_type: '', description: '',
    base_price: 1250, status: 'draft', featured: false, order_mode: 'cart', tag: null
  });
  assert.equal(validateProductForm({ ...emptyProductForm(), name: 'X', slug: 'x', category: 'polos', basePrice: '' }).value.base_price, null);

  const bad = validateProductForm({ ...emptyProductForm(), name: '', slug: 'Polo Seven', category: 'sapatos', basePrice: '-5', status: 'x', orderMode: 'y' });
  assert.equal(bad.valid, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['basePrice', 'category', 'name', 'orderMode', 'slug', 'status']);
  assert.equal(bad.errors.basePrice, 'Não pode ser negativo.');
  assert.equal(validateProductForm({ ...emptyProductForm(), name: 'A', slug: 'a', category: 'polos', basePrice: '12.5' }).errors.basePrice, 'Usa um número inteiro, sem casas decimais.');
  assert.ok(validateProductForm({ ...emptyProductForm(), name: 'A', slug: '-a', category: 'polos' }).errors.slug);
});

test('validateImageSource aceita URL https, caminho e chave conhecida', () => {
  assert.equal(validateImageSource('https://x.supabase.co/storage/v1/object/public/product-images/a.webp').kind, 'url');
  assert.equal(validateImageSource('/assets/images/tee-verde-modelo-800.webp').kind, 'path');
  assert.equal(validateImageSource('tee-verde-modelo').kind, 'key');
  assert.equal(validateImageSource('http://inseguro.com/a.jpg').ok, false);
  assert.equal(validateImageSource('chave-inexistente').ok, false);
  assert.equal(validateImageSource('').ok, false);
  assert.equal(validateImageSource('isto não é url').ok, false);
});

test('validateImages usa o nome do produto como texto alternativo por omissão', () => {
  const result = validateImages([
    { key: 'a', id: 'img-1', src: 'tee-verde-modelo', alt: '', color: '' },
    { key: 'b', id: null, src: 'https://cdn.exemplo.com/x.webp', alt: 'Costas', color: 'Verde' },
    { key: 'c', id: null, src: 'lixo inválido', alt: '', color: '' }
  ], 'T-shirt Seven');
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(error => [error.index, error.field]), [[2, 'src']]);
  assert.deepEqual(result.rows[0], { key: 'a', id: 'img-1', image_url: 'tee-verde-modelo', alt_text: 'T-shirt Seven', color: null, position: 0 });
  assert.equal(result.rows[1].color, 'Verde');
  assert.equal(result.rows[1].position, 1);
});

test('validateVariants deteta cor em falta, repetidos, negativos e não inteiros', () => {
  const result = validateVariants([
    newVariantEntry('a', { color: 'Verde', size: 'M', stock: '3', priceOverride: '' }),
    newVariantEntry('b', { color: ' verde ', size: 'M', stock: '1' }),
    newVariantEntry('c', { color: '', size: 'L' }),
    newVariantEntry('d', { color: 'Preto', size: '', stock: '-1', priceOverride: '9.5' }),
    newVariantEntry('e', { color: 'Preto', size: 'S', stock: '2.5', sku: 'ABC' }),
    newVariantEntry('f', { color: 'Branco', size: 'S', sku: 'abc' })
  ]);
  const errors = result.errors.map(error => `${error.index}:${error.field}`);
  assert.deepEqual(errors, ['1:size', '2:color', '3:stock', '3:priceOverride', '4:stock', '5:sku']);
  assert.match(result.errors[0].message, /Combinação repetida: verde \/ M \(igual à linha 1\)/);
  assert.match(result.errors.find(error => error.index === 3 && error.field === 'stock').message, /negativo/);
  assert.match(result.errors.find(error => error.index === 4).message, /sem casas decimais/);

  const ok = validateVariants([
    newVariantEntry('a', { color: 'Verde', size: '', stock: '', priceOverride: '1500', sku: ' ' }),
    newVariantEntry('b', { color: 'Verde', size: 'S', stock: '0' })
  ]);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.rows.map(({ key, ...row }) => row), [
    { id: null, color: 'Verde', size: null, stock: null, price_override: 1500, sku: null, position: 0 },
    { id: null, color: 'Verde', size: 'S', stock: 0, price_override: null, sku: null, position: 1 }
  ]);
});

test('sizeOptions inclui Único, tamanhos da configuração e valores extra', () => {
  const values = sizeOptions().map(option => option.value);
  assert.deepEqual(values, ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL']);
  assert.equal(sizeOptions()[0].label, 'Único');
  assert.equal(sizeOptions('3XL').at(-1).value, '3XL');
});

test('generateSizeRows cria S…XXL sem repetir tamanhos existentes', () => {
  assert.deepEqual([...QUICK_SIZES], ['S', 'M', 'L', 'XL', 'XXL']);
  const makeKey = createKeyFactory('g');
  const existing = [newVariantEntry('x', { color: 'Preto', size: 'M' })];
  const rows = generateSizeRows(existing, ' preto ', makeKey);
  assert.deepEqual(rows.map(row => row.size), ['S', 'L', 'XL', 'XXL']);
  assert.ok(rows.every(row => row.color === 'preto' && row.id === null && row.stock === ''));
  assert.deepEqual(rows.map(row => row.key), ['g1', 'g2', 'g3', 'g4']);
  assert.deepEqual(generateSizeRows(existing, '', makeKey), []);
});

test('moveItem reordena sem sair dos limites', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  const list = ['a', 'b'];
  assert.equal(moveItem(list, 0, -1), list);
  assert.equal(moveItem(list, 1, 1), list);
});

test('formSnapshot deteta alterações de conteúdo mas ignora ids', () => {
  const form = productFormFromDb(productRow());
  const snapshot = formSnapshot(form);
  assert.equal(formSnapshot({ ...form, images: form.images.map(image => ({ ...image, id: null })) }), snapshot);
  assert.notEqual(formSnapshot({ ...form, basePrice: '1300' }), snapshot);
  assert.notEqual(formSnapshot({ ...form, variants: form.variants.slice(1) }), snapshot);
});

// ─── Sincronização ───────────────────────────────────────────────────────────

test('planSync separa apagar, atualizar (só campos alterados) e inserir', () => {
  const original = variantRowsFromDb(productRow().product_variants);
  const form = productFormFromDb(productRow());
  const edited = [
    { ...form.variants[1], stock: '6' }, // v-m: stock 4 → 6 e posição 1 → 0
    newVariantEntry('new-1', { color: 'Rosa', size: 'L', stock: '2' })
  ];
  const { rows } = validateVariants(edited);
  const plan = planSync(original, rows, VARIANT_FIELDS);
  assert.deepEqual(plan.toDelete, ['v-s']);
  assert.deepEqual(plan.toUpdate, [{ id: 'v-m', key: form.variants[1].key, patch: { stock: 6, position: 0 } }]);
  assert.deepEqual(plan.toInsert, [{ key: 'new-1', row: { color: 'Rosa', size: 'L', stock: 2, price_override: null, sku: null, position: 1 } }]);
  assert.equal(plan.empty, false);

  const unchanged = planSync(original, validateVariants(form.variants).rows, VARIANT_FIELDS);
  assert.equal(unchanged.empty, true);
});

test('planSync de imagens deteta reordenação e alt alterado', () => {
  const row = productRow();
  const original = row.product_images.map(image => ({ ...image })).sort((a, b) => a.position - b.position);
  const form = productFormFromDb(row);
  const reordered = [form.images[1], { ...form.images[0], alt: 'Novo alt' }];
  const plan = planSync(original, validateImages(reordered, row.name).rows, IMAGE_FIELDS);
  assert.deepEqual(plan.toUpdate.map(item => [item.id, item.patch]), [
    ['img-2', { position: 0 }],
    ['img-1', { alt_text: 'Novo alt', position: 1 }]
  ]);
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toInsert, []);
});

test('applySyncResult atualiza a referência e atribui ids às linhas novas; falhas ficam pendentes', () => {
  const original = [
    { id: 'a', color: 'Rosa', size: 'S', stock: 1, price_override: null, sku: null, position: 0 },
    { id: 'b', color: 'Rosa', size: 'M', stock: 2, price_override: null, sku: null, position: 1 }
  ];
  const formRows = [
    { key: 'kb', id: 'b', color: 'Rosa', size: 'M', stock: '5', priceOverride: '', sku: '' },
    { key: 'kn', id: null, color: 'Rosa', size: 'L', stock: '1', priceOverride: '', sku: '' },
    { key: 'kf', id: null, color: 'Rosa', size: 'XL', stock: '1', priceOverride: '', sku: '' }
  ];
  const { original: next, rows } = applySyncResult(original, formRows, {
    deleted: ['a'],
    updated: [{ id: 'b', patch: { stock: 5, position: 0 } }],
    inserted: [{ key: 'kn', id: 'new-id', row: { color: 'Rosa', size: 'L', stock: 1, price_override: null, sku: null, position: 1 } }]
  });
  assert.deepEqual(next.map(row => [row.id, row.stock, row.position]), [['b', 5, 0], ['new-id', 1, 1]]);
  assert.deepEqual(rows.map(row => row.id), ['b', 'new-id', null]);
  // A linha que falhou (kf) volta a aparecer como inserção no próximo plano.
  const again = planSync(next, validateVariants(rows).rows, VARIANT_FIELDS);
  assert.deepEqual(again.toInsert.map(item => item.key), ['kf']);
  assert.deepEqual(again.toDelete, []);
  assert.deepEqual(again.toUpdate, []);
});

// ─── Upload ──────────────────────────────────────────────────────────────────

test('validateImageFile aceita jpg/png/webp até 5 MB', () => {
  assert.deepEqual(validateImageFile({ type: 'image/webp', size: 1000, name: 'a.webp' }), { ok: true, ext: 'webp' });
  assert.equal(validateImageFile({ type: 'image/jpeg', size: 5 * 1024 * 1024, name: 'a.jpg' }).ext, 'jpg');
  assert.match(validateImageFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1, name: 'a.png' }).error, /máximo é 5 MB/);
  assert.match(validateImageFile({ type: 'image/gif', size: 10, name: 'a.gif' }).error, /Formato não suportado/);
  assert.equal(validateImageFile({ type: 'image/png', size: 0, name: 'a.png' }).ok, false);
  assert.equal(validateImageFile(null).ok, false);
});

test('uploadPath segue products/<id>/<timestamp>-<nome>.<ext>', () => {
  assert.equal(uploadPath(PRODUCT_ID, 'Foto Frente Ção.JPG', 'image/jpeg', 1700000000000), `products/${PRODUCT_ID}/1700000000000-foto-frente-cao.jpg`);
  assert.equal(uploadPath(PRODUCT_ID, '###.png', 'image/png', 1), `products/${PRODUCT_ID}/1-imagem.png`);
  assert.throws(() => uploadPath(PRODUCT_ID, 'a.gif', 'image/gif'));
});

test('storagePathFromPublicUrl só reconhece o bucket product-images do projeto', () => {
  const base = 'https://abc.supabase.co';
  assert.equal(storagePathFromPublicUrl(`${base}/storage/v1/object/public/product-images/products/x/1-a.webp`, base), 'products/x/1-a.webp');
  assert.equal(storagePathFromPublicUrl(`${base}/storage/v1/object/public/product-images/products/x/1%20a.webp?v=1`, `${base}/`), 'products/x/1 a.webp');
  assert.equal(storagePathFromPublicUrl('https://outro.com/a.webp', base), null);
  assert.equal(storagePathFromPublicUrl('tee-verde-modelo', base), null);
  assert.equal(storagePathFromPublicUrl('x', ''), null);
});

// ─── Pedidos ─────────────────────────────────────────────────────────────────

const orderRow = () => ({
  id: 'order-1',
  order_number: 'GSL-0047',
  customer_name: 'Ana Maria',
  phone: '841234567',
  location: 'Bairro 1',
  delivery_type: 'entrega',
  notes: 'Ligar antes',
  subtotal: 2500,
  delivery_fee: null,
  total: 2500,
  status: 'novo',
  created_at: '2026-09-20T10:30:00Z',
  order_items: [
    { product_name_snapshot: 'Polo Seven', color_snapshot: 'Rosa', size_snapshot: 'M', unit_price: 1250, quantity: 1, subtotal: 1250 },
    { product_name_snapshot: 'Boné', color_snapshot: 'Preto', size_snapshot: null, unit_price: 625, quantity: 2, subtotal: 1250 }
  ]
});

test('orderItemCount soma as quantidades', () => {
  assert.equal(orderItemCount(orderRow()), 3);
  assert.equal(orderItemCount({ order_items: [] }), 0);
  assert.equal(orderItemCount({}), 0);
  assert.equal(orderItemCount({ order_items: [{ quantity: 2 }, { quantity: null }, { quantity: -1 }] }), 2);
});

test('orderListRow formata a linha da tabela de pedidos', () => {
  const row = orderListRow(orderRow());
  assert.equal(row.number, 'GSL-0047');
  assert.equal(row.itemCount, 3);
  assert.equal(row.totalLabel, '2.500 MT');
  assert.equal(row.statusLabel, 'Novo');
  assert.equal(row.phoneLabel, '84 123 4567');
  assert.equal(ORDERS_PAGE_SIZE, 25);
});

test('orderDetailFromDb usa os snapshots dos itens', () => {
  const order = orderDetailFromDb(orderRow());
  assert.equal(order.deliveryLabel, 'Entrega');
  assert.deepEqual(order.items[1], { name: 'Boné', color: 'Preto', size: 'Único', quantity: 2, unitPrice: 625, subtotal: 1250 });
  assert.equal(order.itemCount, 3);
  assert.equal(order.deliveryFee, null);
  assert.match(order.whatsappURL, /^https:\/\/wa\.me\/258841234567\?text=/);
});

test('customerWhatsAppURL só existe com telefone válido', () => {
  const url = customerWhatsAppURL(orderRow());
  assert.ok(url.startsWith('https://wa.me/258841234567?text='));
  assert.match(decodeURIComponent(url.split('text=')[1]), /^Olá Ana! .*#GSL-0047/);
  assert.equal(customerWhatsAppURL({ ...orderRow(), phone: '123' }), null);
  assert.equal(customerWhatsAppURL({ ...orderRow(), phone: '' }), null);
  assert.ok(customerWhatsAppURL({ ...orderRow(), phone: '+27 82 123 4567' }).startsWith('https://wa.me/27821234567'));
});

test('orderSearchFilter gera filtro "or" seguro para o PostgREST', () => {
  assert.equal(orderSearchFilter(''), '');
  assert.equal(orderSearchFilter('  ,() '), '');
  assert.equal(orderSearchFilter('GSL-0047'), 'order_number.ilike.*GSL-0047*,customer_name.ilike.*GSL-0047*,phone.ilike.*GSL-0047*');
  const injected = orderSearchFilter('ana),status.eq.(cancelado');
  assert.ok(!/[()]/.test(injected), 'parênteses removidos');
  assert.equal(injected.split(',').length, 3, 'vírgulas não criam novas condições');
  assert.ok(orderSearchFilter('841234567').endsWith(',phone.ilike.*8*4*1*2*3*4*5*6*7*'));
  assert.ok(!orderSearchFilter('0047').includes('*0*0*'), 'números curtos não usam a pesquisa solta de telefone');
});

// ─── Erros ───────────────────────────────────────────────────────────────────

test('authErrorMessage traduz erros comuns de login', () => {
  assert.equal(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), 'Email ou palavra-passe incorretos.');
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Email ou palavra-passe incorretos.');
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /não foi confirmado/);
  assert.match(authErrorMessage({ status: 429, message: 'Too many requests' }), /Demasiadas tentativas/);
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /Sem ligação/);
  assert.equal(authErrorMessage({ message: 'estranho' }), 'Não foi possível entrar. Tenta novamente.');
});

test('dbErrorMessage traduz erros do PostgREST e do Storage', () => {
  assert.match(dbErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "products_slug_key"' }), /slug/);
  assert.match(dbErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "product_variants_sku_key"' }), /SKU/);
  assert.match(dbErrorMessage({ code: '23505', message: 'duplicate key', details: 'Key (product_id, color, size)=(…) already exists.' }), /cor e tamanho/);
  assert.match(dbErrorMessage({ code: '42501', message: 'new row violates row-level security policy' }), /Sem permissão/);
  assert.match(dbErrorMessage({ message: 'new row violates row-level security policy', statusCode: '403' }), /Sem permissão/);
  assert.match(dbErrorMessage({ code: 'NO_ROWS' }), /Nada foi alterado/);
  assert.match(dbErrorMessage({ code: '', message: 'TypeError: Failed to fetch' }), /Sem ligação/);
  assert.match(dbErrorMessage({ code: '', message: 'TimeoutError: signal timed out' }), /demorou demasiado/);
  assert.match(dbErrorMessage({ message: 'Bucket not found' }), /product-images/);
  assert.equal(dbErrorMessage({ code: 'XX', message: 'boom' }), 'Erro do servidor: boom');
  assert.equal(dbErrorMessage(null), 'Ocorreu um erro inesperado.');
});
