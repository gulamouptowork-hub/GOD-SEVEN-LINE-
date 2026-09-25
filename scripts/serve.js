// Servidor local para dist/ com o mesmo comportamento do vercel.json (cleanUrls, rewrites, 404).
// Uso: npm run dev  (build + serve)  ·  PORT=5000 npm run serve
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DIST_DIR permite servir outra pasta gerada com  node scripts/build.js --out <pasta>.
const root = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

if (!fs.existsSync(root)) {
  console.error('dist/ não existe. Corre primeiro: npm run build');
  process.exit(1);
}

const file = relative => {
  const target = path.join(root, relative);
  if (!target.startsWith(root)) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
};

function resolve(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
  if (clean === '/') return { target: file('index.html') };
  if (/\.html$/.test(clean)) return { redirect: clean.replace(/\.html$/, '').replace(/\/index$/, '') || '/' };
  if (/^\/God-seven-line$/i.test(clean) || clean === '/index') return { redirect: '/' };
  const direct = file(clean) ?? file(`${clean}.html`) ?? file(`${clean}/index.html`);
  if (direct) return { target: direct };
  if (/^\/produtos\/[^/]+$/.test(clean)) return { target: file('produto.html') };
  return { target: file('404.html'), status: 404 };
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const { target, redirect, status = 200 } = resolve(url.pathname);
  if (redirect) {
    response.writeHead(308, { Location: redirect + url.search });
    response.end();
    return;
  }
  if (!target) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(status, { 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(response);
}).listen(port, () => console.log(`God Seven Line → http://localhost:${port}`));
