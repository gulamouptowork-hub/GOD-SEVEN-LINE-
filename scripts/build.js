// Gera o site estático em dist/.
//   node scripts/build.js          → catálogo real (data/products.json ou Supabase, se configurado)
//   node scripts/build.js --demo   → catálogo de demonstração (tests/fixtures/products.demo.json) — nunca publicar
//   --out <pasta>                  → gera noutra pasta (usado nos testes)
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_ANON_KEY, WHATSAPP_NUMBER (ver docs/SETUP.md).
// Também aceita os nomes do exemplo do Supabase: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_CONFIG } from '../config/site.js';
import { normalizeProduct, validateCatalog } from '../js/lib/catalog.js';
import { mapSupabaseProduct } from '../js/services/products.js';
import { layout } from './templates/layout.js';
import {
  catalogPage, checkoutPage, contactPage, homePage, locationPage, notFoundPage, productFallbackShell,
  productPage, servicesPage, storyPage
} from './templates/pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
const dist = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : path.join(root, 'dist');
const demo = process.argv.includes('--demo');
const env = (...names) => names.map(name => String(process.env[name] ?? '').trim()).find(Boolean) ?? '';

const runtime = {
  supabaseUrl: demo ? '' : env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, ''),
  supabaseAnonKey: demo ? '' : env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  whatsappNumber: env('WHATSAPP_NUMBER').replace(/\D/g, ''),
  demo
};
const whatsappNumber = runtime.whatsappNumber || SITE_CONFIG.whatsappNumber;

const looksSecret = key => key.startsWith('sb_secret_') || /service_role/i.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString());
if (runtime.supabaseAnonKey && looksSecret(runtime.supabaseAnonKey)) {
  console.error('✗ SUPABASE_ANON_KEY contém uma service_role key. Usa a anon (public) key — a service_role nunca pode ir para o browser.');
  process.exit(1);
}

async function loadCatalog() {
  const file = path.join(root, demo ? 'tests/fixtures/products.demo.json' : 'data/products.json');
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateCatalog(local);
  if (errors.length) {
    console.error(`✗ Catálogo inválido (${path.relative(root, file)}):\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  if (runtime.supabaseUrl && runtime.supabaseAnonKey) {
    try {
      const select = 'id,slug,name,description,category,product_type,base_price,status,featured,order_mode,tag,created_at,updated_at,product_images(image_url,alt_text,position,color),product_variants(id,color,size,stock,price_override,sku,position)';
      const response = await fetch(`${runtime.supabaseUrl}/rest/v1/products?select=${select}&status=eq.active&order=created_at.desc.nullslast,name.asc`, {
        headers: { apikey: runtime.supabaseAnonKey, ...(runtime.supabaseAnonKey.startsWith('eyJ') ? { Authorization: `Bearer ${runtime.supabaseAnonKey}` } : {}) }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      console.log(`• Catálogo do Supabase: ${rows.length} produtos`);
      return { products: rows.map(mapSupabaseProduct), localRaw: local };
    } catch (error) {
      console.warn(`! Não foi possível ler o Supabase no build (${error.message}). A usar ${path.relative(root, file)} para as páginas estáticas.`);
    }
  }
  return { products: local.map(normalizeProduct).filter(product => product.status === 'active'), localRaw: local };
}

function copy(from, to) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, path.join(dist, to ?? from), { recursive: true });
}

function write(file, content) {
  const target = path.join(dist, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const { products, localRaw } = await loadCatalog();
const now = new Date();

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Ficheiros estáticos (as fotografias originais ficam de fora).
copy('assets/images');
copy('assets/icons');
copy('styles');
copy('js');
copy('admin');
copy('config/site.js');
write('config/runtime.js', `// Gerado por scripts/build.js — não editar.\nexport const RUNTIME_CONFIG = Object.freeze(${JSON.stringify(runtime, null, 2)});\n`);
write('data/products.json', `${JSON.stringify(localRaw, null, 2)}\n`);

// Árvore de imports estáticos de cada entrada → <link rel="modulepreload"> (evita a cascata de pedidos).
function moduleGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = fs.readFileSync(path.join(root, entry), 'utf8');
  for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    moduleGraph(path.posix.normalize(path.posix.join(path.posix.dirname(entry), specifier)), seen);
  }
  return seen;
}
const PAGE_MODULES = { home: 'js/pages/home.js', catalog: 'js/pages/catalog.js', product: 'js/pages/product.js', checkout: 'js/pages/checkout.js' };
const preloadFor = pageName => {
  const graph = moduleGraph('js/app.js');
  if (PAGE_MODULES[pageName]) moduleGraph(PAGE_MODULES[pageName], graph);
  return [...graph].map(file => `/${file}`);
};

const pages = [];
const page = (file, pathName, options) => {
  write(file, layout({ path: pathName, demo, preload: preloadFor(options.page), ...options }));
  if (!options.noindex) pages.push(pathName);
};

const shared = { products, now, whatsappNumber };
page('index.html', '/', {
  page: 'home', title: `${SITE_CONFIG.brandName} — Veste a tua história`, fullTitle: true,
  description: 'Streetwear moçambicano com identidade. Descobre a coleção God Seven Line, monta o teu pedido e envia-o pelo WhatsApp.',
  ...homePage(shared)
});
page('produtos.html', '/produtos', {
  page: 'catalog', title: 'Coleção', description: 'Descobre a coleção God Seven Line: t-shirts, polos, acessórios e peças personalizadas. Escolhe cor e tamanho e monta o teu pedido.',
  ...catalogPage(shared)
});
for (const product of products) {
  const content = productPage({ product, ...shared });
  page(`produtos/${product.slug}.html`, `/produtos/${product.slug}`, {
    page: 'product', title: `${product.name} — ${product.productType}`, ...content
  });
}
page('produto.html', '/produto', { page: 'product', title: 'Peça', noindex: true, body: productFallbackShell({}) });
page('finalizar.html', '/finalizar', { page: 'checkout', title: 'Finalizar pedido', noindex: true, ...checkoutPage() });
page('servicos.html', '/servicos', {
  page: 'services', title: 'Personalização', description: 'Personalização de t-shirts, polos, hoodies, uniformes e sacolas em Moçambique. Serigrafia, DTF e apoio criativo.',
  image: 'personalizacao-banner', ...servicesPage(shared)
});
page('sobre.html', '/sobre', { page: 'story', title: 'A nossa história', description: 'Sete linhas. Um propósito. A história da God Seven Line, nascida em Moçambique em 2025.', image: 'polos-grupo', ...storyPage() });
page('Localizacao.html', '/Localizacao', { page: 'location', title: 'Encontra-nos', description: `Visita a God Seven Line: ${SITE_CONFIG.contact.address}.`, image: 'signature-preto', ...locationPage(shared) });
page('contactos.html', '/contactos', { page: 'contact', title: 'Contactos', description: 'Fala com a God Seven Line pelo WhatsApp ou Instagram.', ...contactPage(shared) });
page('404.html', '/404', { page: 'not-found', title: 'Página não encontrada', noindex: true, ...notFoundPage() });

write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /finalizar\nSitemap: ${SITE_CONFIG.siteUrl}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
  .map(url => `  <url><loc>${SITE_CONFIG.siteUrl}${url === '/' ? '/' : url}</loc></url>`).join('\n')}\n</urlset>\n`);

console.log(`✓ dist/ gerado — ${pages.length} páginas indexáveis, ${products.length} produtos${demo ? ' (MODO DEMONSTRAÇÃO)' : ''}`);
console.log(`  Modo: ${runtime.supabaseUrl && runtime.supabaseAnonKey ? 'Supabase' : 'local (sem backend)'} · WhatsApp: ${whatsappNumber}`);
