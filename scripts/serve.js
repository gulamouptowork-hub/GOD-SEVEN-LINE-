// Servidor local para dist/ com o mesmo comportamento do vercel.json (cleanUrls, rewrites, 404).
// Uso: npm run dev  (build + serve)  ·  PORT=5000 npm run serve
// Só responde neste computador (127.0.0.1). Para abrir no telemóvel na mesma rede: HOST=0.0.0.0 npm run serve
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DIST_DIR permite servir outra pasta gerada com  node scripts/build.js --out <pasta>.
const root = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

if (!fs.existsSync(root)) {
  console.error('dist/ não existe. Corre primeiro: npm run build');
  process.exit(1);
}

// Nunca sai da pasta servida (nem para pastas vizinhas como dist-demo/).
const file = relative => {
  const target = path.join(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
};

// Redirecionamento sempre para um caminho deste site: "//outro.site" ou "/\outro.site" ficariam fora dele.
const localRedirect = clean => `/${encodeURI(clean.replace(/^[/\\]+/, ''))}`;

function resolve(pathname) {
  let clean;
  try { clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/'; }
  catch { return { target: file('404.html'), status: 400 }; }
  if (clean === '/') return { target: file('index.html') };
  if (/\.html$/.test(clean)) return { redirect: localRedirect(clean.replace(/\.html$/, '').replace(/\/index$/, '')) };
  if (/^\/God-seven-line$/i.test(clean) || clean === '/index') return { redirect: '/' };
  const direct = file(clean) ?? file(`${clean}.html`) ?? file(`${clean}/index.html`);
  if (direct) return { target: direct };
  if (/^\/produtos\/[^/]+$/.test(clean)) return { target: file('produto.html') };
  return { target: file('404.html'), status: 404 };
}

http.createServer((request, response) => {
  // Base fixa: um cabeçalho Host inválido não pode derrubar o servidor.
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { response.writeHead(400); response.end('Bad request'); return; }
  const { target, redirect, status = 200 } = resolve(url.pathname);
  if (redirect) {
    response.writeHead(308, { Location: redirect + url.search });
    response.end();
    return;
  }
  if (!target) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(status, { 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  // O ficheiro pode desaparecer a meio (ex.: um build a correr ao mesmo tempo).
  fs.createReadStream(target).on('error', () => response.destroy()).pipe(response);
}).listen(port, host, () => console.log(`God Seven Line → http://localhost:${port}${host === '127.0.0.1' ? '' : ` (também na rede: ${host})`}`));
