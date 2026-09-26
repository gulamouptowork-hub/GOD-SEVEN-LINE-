import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_CONFIG } from '../config/site.js';
import { productJSONLD } from '../scripts/templates/pages.js';
import { demoProducts } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanEnv = { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', WHATSAPP_NUMBER: '', ALLOW_LOCAL_FALLBACK: '' };

function build(args = [], env = cleanEnv) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-build-'));
  execFileSync(process.execPath, ['scripts/build.js', '--out', out, ...args], { cwd: root, env, stdio: 'pipe' });
  return { out, read: file => fs.readFileSync(path.join(out, file), 'utf8') };
}

// Versão assíncrona (o processo de teste continua livre para responder como servidor Supabase falso).
function buildAsync(args = [], env = cleanEnv, cwd = root) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-build-'));
  return new Promise(resolve => {
    execFile(process.execPath, ['scripts/build.js', '--out', out, ...args], { cwd, env }, (error, stdout, stderr) => {
      resolve({ out, status: error ? error.code : 0, stdout, stderr, read: file => fs.readFileSync(path.join(out, file), 'utf8') });
    });
  });
}

// Servidor Supabase falso: responde a GET /rest/v1/products com handler(request, response).
async function fakeSupabase(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

const jsonLDBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(match => JSON.parse(match[1]));

test('build real: páginas, SEO e nenhum preço inventado', () => {
  const site = build();
  for (const file of ['index.html', 'produtos.html', 'finalizar.html', 'produto.html', '404.html', 'servicos.html', 'sobre.html', 'Localizacao.html', 'contactos.html', 'sitemap.xml', 'robots.txt', 'config/runtime.js', 'admin/index.html']) {
    assert.ok(fs.existsSync(path.join(site.out, file)), file);
  }
  const polo = site.read('produtos/polo-seven.html');
  assert.match(polo, /<title>Polo Seven — Polo — God Seven Line<\/title>/);
  assert.match(polo, /<link rel="canonical" href="https:\/\/god-seven-line\.vercel\.app\/produtos\/polo-seven">/);
  assert.match(polo, /property="og:type" content="product"/);
  assert.match(polo, /data-price>Preço sob consulta</);
  assert.match(polo, /PERGUNTAR NO WHATSAPP/);
  assert.match(polo, /href="https:\/\/wa\.me\/258870204282\?text=[^"]+"/);
  assert.doesNotMatch(polo, /"offers"/, 'sem preço não há oferta no JSON-LD');
  assert.deepEqual(jsonLDBlocks(polo).map(block => block['@type']), ['BreadcrumbList'], 'sem preço não há Product (o Google exige offers)');
  assert.match(site.read('sitemap.xml'), /\/produtos\/polo-seven</);
  assert.doesNotMatch(site.read('sitemap.xml'), /finalizar|admin|produto</);
  assert.match(site.read('robots.txt'), /Disallow: \/admin/);
  assert.match(site.read('finalizar.html'), /name="robots" content="noindex"/);
  const runtime = site.read('config/runtime.js');
  assert.match(runtime, /"supabaseUrl": ""/);
  assert.match(runtime, /"demo": false/);
  assert.doesNotMatch(site.read('index.html'), /MODO DEMONSTRAÇÃO/);
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('build demo: preços, stock e oferta estruturada', () => {
  const site = build(['--demo']);
  const polo = site.read('produtos/polo-seven.html');
  assert.match(polo, /data-price>1\.500 MT</);
  assert.match(polo, /ADICIONAR AO PEDIDO/);
  const offer = jsonLDBlocks(polo)[0].offers;
  assert.equal(offer.price, 1500);
  assert.equal(offer.priceCurrency, 'MZN');
  assert.match(site.read('produtos/seven-street-tee.html'), /ESGOTADO/);
  assert.match(site.read('index.html'), /MODO DEMONSTRAÇÃO/);
  assert.match(site.read('config/runtime.js'), /"demo": true/);
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('JSON-LD: preços diferentes por variante → uma Offer por variante (sem AggregateOffer)', () => {
  const signature = demoProducts().find(product => product.slug === 'seven-signature');
  const product = jsonLDBlocks(productJSONLD(signature)).find(block => block['@type'] === 'Product');
  assert.ok(Array.isArray(product.offers));
  assert.ok(product.offers.every(offer => offer['@type'] === 'Offer' && offer.priceCurrency === 'MZN'));
  assert.equal(product.offers.length, signature.variants.length);
  assert.deepEqual([...new Set(product.offers.map(offer => offer.price))].sort(), [1250, 1350]);
  assert.doesNotMatch(JSON.stringify(product), /AggregateOffer/);

  const soldOut = { ...signature, variants: signature.variants.map((variant, index) => ({ ...variant, stock: index === 0 ? 0 : 10 })) };
  const [first, second] = jsonLDBlocks(productJSONLD(soldOut)).find(block => block['@type'] === 'Product').offers;
  assert.equal(first.availability, 'https://schema.org/OutOfStock');
  assert.equal(second.availability, 'https://schema.org/InStock');

  const noPrice = { ...signature, basePrice: null, variants: signature.variants.map(variant => ({ ...variant, priceOverride: null })) };
  assert.deepEqual(jsonLDBlocks(productJSONLD(noPrice)).map(block => block['@type']), ['BreadcrumbList']);
});

test('páginas editoriais: contactos e horário vêm de config/site.js; banner de /servicos com sizes reais', () => {
  const site = build();
  const { contact } = SITE_CONFIG;
  const contacts = site.read('contactos.html');
  for (const item of contact.hours) assert.ok(contacts.includes(`${item.days} · ${item.time}`), item.days);
  assert.doesNotMatch(contacts, /Segunda a Sábado/);
  const location = site.read('Localizacao.html');
  assert.ok(location.includes(`<h2>${contact.addressTitle.replace(/\n/g, '<br>')}</h2>`));
  assert.ok(location.includes(`<p>${contact.city}. Procura`));
  const banner = site.read('servicos.html').match(/<img[^>]*personalizacao-banner[^>]*>/)[0];
  assert.match(banner, /sizes="\(min-width: 641px\) 1550px, 900px"/);
  assert.match(banner, /fetchpriority="high"/);
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('layout: botão de pesquisa com nome acessível e .reveal só escondido quando o JS corre', () => {
  const site = build();
  const home = site.read('index.html');
  assert.match(home, /<button class="header-action header-action--search"[^>]*aria-label="Pesquisa"/);
  const head = home.slice(0, home.indexOf('</head>'));
  assert.match(head, /<script>[^<]*classList\.add\('js'\)[^<]*reveal-ready[^<]*classList\.remove\('js'\)[^<]*<\/script>/, 'a classe .js é posta antes do primeiro paint e retirada se o app.js não correr');
  assert.match(fs.readFileSync(path.join(root, 'js/ui/reveal.js'), 'utf8'), /classList\.add\('reveal-ready'\)/);
  const css = fs.readFileSync(path.join(root, 'styles/god-seven.css'), 'utf8');
  assert.match(css, /\.js \.reveal\{opacity:0/);
  assert.doesNotMatch(css, /(^|[},])\.reveal\{opacity:0/, 'sem JS o conteúdo .reveal fica visível');
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('data/products.json publicado só tem produtos ativos (rascunhos nunca ficam públicos)', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-project-'));
  for (const dir of ['scripts', 'config', 'js']) fs.cpSync(path.join(root, dir), path.join(project, dir), { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8'));
  const draft = { ...catalog[0], id: 'drop-secreto', slug: 'drop-secreto-2027', name: 'Drop secreto', status: 'draft', basePrice: 1999, variants: [] };
  const archived = { ...catalog[0], id: 'antigo', slug: 'peca-antiga', name: 'Peça antiga', status: 'archived', variants: [] };
  fs.mkdirSync(path.join(project, 'data'));
  fs.writeFileSync(path.join(project, 'data/products.json'), JSON.stringify([...catalog, draft, archived]));
  const out = path.join(project, 'out');
  execFileSync(process.execPath, ['scripts/build.js', '--out', out], { cwd: project, env: cleanEnv, stdio: 'pipe' });
  const published = JSON.parse(fs.readFileSync(path.join(out, 'data/products.json'), 'utf8'));
  assert.deepEqual(published.map(product => product.slug), catalog.map(product => product.slug));
  assert.ok(published.every(product => product.status === 'active'));
  assert.ok(!fs.existsSync(path.join(out, 'produtos/drop-secreto-2027.html')));
  fs.rmSync(project, { recursive: true, force: true });
});

test('WHATSAPP_NUMBER substitui o número em todo o site', () => {
  const site = build([], { ...cleanEnv, WHATSAPP_NUMBER: '+258 84 000 0000' });
  assert.match(site.read('contactos.html'), /wa\.me\/258840000000/);
  assert.doesNotMatch(site.read('servicos.html'), /wa\.me\/258870204282/);
  assert.match(site.read('config/runtime.js'), /"whatsappNumber": "258840000000"/);
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('build recusa uma service_role key', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-build-'));
  const result = spawnSync(process.execPath, ['scripts/build.js', '--out', out], {
    cwd: root, env: { ...cleanEnv, SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_ANON_KEY: `x.${payload}.y` }, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /service_role/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('Supabase configurado mas inacessível: o build falha e não mexe na pasta de saída', async () => {
  const supabase = await fakeSupabase((request, response) => { response.writeHead(401); response.end('{"message":"Invalid API key"}'); });
  try {
    const env = { ...cleanEnv, SUPABASE_URL: supabase.url, SUPABASE_ANON_KEY: 'sb_publishable_teste' };
    const denied = await buildAsync([], env);
    fs.writeFileSync(path.join(denied.out, 'ultimo-deploy-bom.txt'), 'ok');
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /Não foi possível ler o Supabase no build \(HTTP 401/);
    assert.match(denied.stderr, /ALLOW_LOCAL_FALLBACK=1/);

    const down = await buildAsync([], { ...env, SUPABASE_URL: 'http://127.0.0.1:9' });
    fs.writeFileSync(path.join(down.out, 'ultimo-deploy-bom.txt'), 'ok');
    assert.notEqual(down.status, 0);
    assert.match(down.stderr, /Não foi possível ler o Supabase/);
    assert.deepEqual(fs.readdirSync(down.out), ['ultimo-deploy-bom.txt']);
    for (const site of [denied, down]) fs.rmSync(site.out, { recursive: true, force: true });
  } finally {
    await supabase.close();
  }
});

test('Supabase responde: as páginas estáticas vêm da base de dados', async () => {
  let request;
  const supabase = await fakeSupabase((incoming, response) => {
    request = incoming;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify([{
      id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', slug: 'hoodie-teste', name: 'Hoodie Teste', description: 'Peça criada no admin.',
      category: 'hoodies', product_type: 'Hoodie', base_price: null, status: 'active', featured: false, order_mode: 'cart', tag: null,
      created_at: null, updated_at: null, product_images: [{ image_url: 'tee-verde-modelo', alt_text: 'Hoodie', position: 0, color: null }],
      product_variants: [{ id: '4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', color: 'Preto', size: 'M', stock: null, price_override: null, sku: null, position: 0 }]
    }]));
  });
  try {
    const site = await buildAsync([], { ...cleanEnv, SUPABASE_URL: supabase.url, SUPABASE_ANON_KEY: 'sb_publishable_teste' });
    assert.equal(site.status, 0, site.stderr);
    assert.match(site.stdout, /Catálogo do Supabase: 1 produtos/);
    assert.match(site.stdout, /Modo: Supabase ·/);
    assert.equal(request.headers.apikey, 'sb_publishable_teste');
    assert.match(site.read('produtos/hoodie-teste.html'), /Hoodie Teste/);
    assert.ok(!fs.existsSync(path.join(site.out, 'produtos/polo-seven.html')), 'não usa data/products.json');
    fs.rmSync(site.out, { recursive: true, force: true });
  } finally {
    await supabase.close();
  }
});

test('aceita os nomes NEXT_PUBLIC_ do exemplo do Supabase (ALLOW_LOCAL_FALLBACK=1 gera mesmo sem Supabase)', async () => {
  const site = await buildAsync([], { ...cleanEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste', ALLOW_LOCAL_FALLBACK: '1' });
  assert.equal(site.status, 0, site.stderr);
  const runtime = site.read('config/runtime.js');
  assert.ok(runtime.includes('"supabaseUrl": "http://127.0.0.1:9"'), runtime);
  assert.ok(runtime.includes('"supabaseAnonKey": "sb_publishable_teste"'), runtime);
  assert.match(site.stdout, /Modo: Supabase \(páginas estáticas de data\/products\.json — Supabase inacessível no build\)/);
  assert.ok(fs.existsSync(path.join(site.out, 'produtos/polo-seven.html')));
  fs.rmSync(site.out, { recursive: true, force: true });
});

test('servidor local: redirecionamentos só dentro do site, pastas vizinhas fechadas e URLs inválidos → 400', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-serve-'));
  const dist = path.join(base, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), 'início');
  fs.writeFileSync(path.join(dist, '404.html'), 'não encontrado');
  fs.mkdirSync(path.join(base, 'dist-demo'));
  fs.writeFileSync(path.join(base, 'dist-demo', 'segredo.txt'), 'segredo');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...cleanEnv, DIST_DIR: dist, PORT: String(port), HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', reject); });
    const get = pathname => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: pathname }, response => { response.resume(); resolve(response); }).on('error', reject);
    });
    const evil = await get('/%2Fevil.example/x.html');
    assert.equal(evil.statusCode, 308);
    assert.equal(evil.headers.location, '/evil.example/x');
    assert.equal((await get('/%5Cevil.example/x.html')).headers.location, '/evil.example/x');
    assert.equal((await get('/%09/evil.example/x.html')).headers.location, '/%09/evil.example/x');
    assert.equal((await get('/produtos.html?q=1')).headers.location, '/produtos?q=1');
    assert.equal((await get('/..%2Fdist-demo/segredo.txt')).statusCode, 404);
    assert.equal((await get('/%E0%A4%A')).statusCode, 400);
    assert.equal((await get('/')).statusCode, 200, 'o servidor continua vivo');
  } finally {
    server.kill();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
