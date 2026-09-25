// Verificações estáticas (equivalente a lint para este projeto sem dependências):
//  1. sintaxe de todos os módulos JS;  2. links/recursos internos de dist/ existem;
//  3. SEO mínimo por página;  4. regras de negócio visíveis (preços, WhatsApp).
// Uso: npm run build && npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const problems = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return ['node_modules', 'dist', '.git', 'originals'].includes(entry.name) ? [] : walk(full);
  return [full];
});

// 1. Sintaxe
const sources = walk(root).filter(file => /\.(js|mjs)$/.test(file));
for (const file of sources) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { problems.push(`sintaxe: ${path.relative(root, file)}\n${error.stderr}`); }
}

// 2–4. dist/
if (!fs.existsSync(dist)) {
  problems.push('dist/ não existe — corre npm run build primeiro.');
} else {
  const exists = url => {
    const clean = decodeURIComponent(url.split(/[?#]/)[0]).replace(/\/$/, '') || '/';
    if (clean === '/') return true;
    const target = path.join(dist, clean);
    return [target, `${target}.html`, path.join(target, 'index.html')].some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      || /^\/produtos\/[^/]+$/.test(clean);
  };
  const pages = walk(dist).filter(file => file.endsWith('.html'));
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const name = path.relative(dist, file).replace(/\\/g, '/');
    for (const [, url] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      if (!exists(url)) problems.push(`${name}: recurso inexistente ${url}`);
    }
    for (const [, set] of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of set.split(',').map(item => item.trim().split(' ')[0])) {
        if (candidate.startsWith('/') && !exists(candidate)) problems.push(`${name}: srcset inexistente ${candidate}`);
      }
    }
    if (name.startsWith('admin/')) continue;
    if (!/<title>[^<]{5,}<\/title>/.test(html)) problems.push(`${name}: falta <title>`);
    if (!/<meta name="description" content="[^"]{20,}"/.test(html)) problems.push(`${name}: falta meta description`);
    if (!/<h1[\s>]/.test(html) && !['produto.html'].includes(name)) problems.push(`${name}: falta <h1>`);
    const noindex = html.includes('name="robots" content="noindex"');
    if (!noindex && !/<link rel="canonical" href="https:\/\/[^"]+"/.test(html)) problems.push(`${name}: falta canonical`);
    for (const [, alt] of html.matchAll(/<img(?![^>]*\balt=)[^>]*>/g)) problems.push(`${name}: <img> sem alt ${alt ?? ''}`);
    for (const [, url] of html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)) {
      if (!/^https:\/\/wa\.me\/\d{8,15}(\?text=[^"\s]*)?$/.test(url.replace(/&amp;/g, '&'))) problems.push(`${name}: link WhatsApp mal formado ${url}`);
    }
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(json); } catch { problems.push(`${name}: JSON-LD inválido`); }
    }
  }
  // Nunca "Preço sob consulta" num produto com preço configurado.
  const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/products.json'), 'utf8'));
  for (const product of catalog) {
    const file = path.join(dist, 'produtos', `${product.slug}.html`);
    if (!fs.existsSync(file)) { if (product.status === 'active') problems.push(`falta página de produto: ${product.slug}`); continue; }
    const hasPrice = Number.isFinite(product.basePrice) || product.variants.some(variant => Number.isFinite(variant.priceOverride));
    const html = fs.readFileSync(file, 'utf8');
    const priceText = html.match(/data-price>([^<]*)</)?.[1] ?? '';
    if (hasPrice && /sob consulta/i.test(priceText)) problems.push(`${product.slug}: mostra "Preço sob consulta" com preço configurado`);
    if (!hasPrice && !/sob consulta/i.test(priceText)) problems.push(`${product.slug}: sem preço mas não mostra "Preço sob consulta"`);
  }
  const numbers = new Set(pages.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/wa\.me\/(\d+)/g)].map(match => match[1])));
  if (numbers.size > 1) problems.push(`vários números de WhatsApp no site: ${[...numbers].join(', ')}`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} problema(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ check: ${sources.length} ficheiros JS, links, SEO e regras de preço OK`);
