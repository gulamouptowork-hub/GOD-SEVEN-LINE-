import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanEnv = { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', WHATSAPP_NUMBER: '' };

function build(args = [], env = cleanEnv) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-build-'));
  execFileSync(process.execPath, ['scripts/build.js', '--out', out, ...args], { cwd: root, env, stdio: 'pipe' });
  return { out, read: file => fs.readFileSync(path.join(out, file), 'utf8') };
}

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
  const offer = JSON.parse(polo.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]).offers;
  assert.equal(offer.price, 1500);
  assert.equal(offer.priceCurrency, 'MZN');
  assert.match(site.read('produtos/seven-street-tee.html'), /ESGOTADO/);
  assert.match(site.read('index.html'), /MODO DEMONSTRAÇÃO/);
  assert.match(site.read('config/runtime.js'), /"demo": true/);
  fs.rmSync(site.out, { recursive: true, force: true });
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

test('aceita os nomes NEXT_PUBLIC_ do exemplo do Supabase', () => {
  const site = build([], { ...cleanEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste' });
  const runtime = site.read('config/runtime.js');
  assert.ok(runtime.includes('"supabaseUrl": "http://127.0.0.1:9"'), runtime);
  assert.ok(runtime.includes('"supabaseAnonKey": "sb_publishable_teste"'), runtime);
  fs.rmSync(site.out, { recursive: true, force: true });
});
