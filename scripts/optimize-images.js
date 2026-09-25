// Gera as imagens otimizadas (WebP responsivo) a partir de assets/originals.
// Uso: npm i --no-save sharp && npm run images
// As imagens geradas ficam em assets/images e são commitadas: o build não depende do sharp.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originals = path.join(root, 'assets/originals');
const output = path.join(root, 'assets/images');
const icons = path.join(root, 'assets/icons');

let sharp;
try { ({ default: sharp } = await import('sharp')); }
catch { console.error('Falta o sharp. Corre: npm i --no-save sharp'); process.exit(1); }

// As fotografias *_2026082* são capturas de stories do Instagram: o recorte remove
// a moldura desfocada, a legenda e o ícone do Instagram, mantendo só a fotografia.
const STORY_CROP = { left: 86, width: 548, top: 348 };
const IMAGES = [
  { key: 'polos-rosa-vermelho', file: 'IMG-20260617-WA0008(1).jpg', widths: [480, 800, 1080] },
  { key: 'tee-verde-modelo', file: 'IMG-20260617-WA0006(1).jpg', widths: [480, 800, 1080] },
  { key: 'tee-verde-detalhe', file: 'IMG_20260829_163547_845.webp', crop: { ...STORY_CROP, height: 610 }, widths: [480, 548] },
  { key: 'tee-verde-costas', file: 'IMG_20260829_163435_761.webp', crop: { ...STORY_CROP, height: 615 }, widths: [480, 548] },
  { key: 'tee-preta-amarelo', file: 'IMG_20260829_163602_585.webp', crop: { ...STORY_CROP, height: 611 }, widths: [480, 548] },
  { key: 'polos-grupo', file: 'IMG_20260829_163739_990.webp', crop: { ...STORY_CROP, height: 620 }, widths: [480, 548] },
  { key: 'street-tee-ktm', file: 'IMG_20260829_163923_927.webp', crop: { ...STORY_CROP, height: 611 }, widths: [480, 548] },
  { key: 'signature-preto', file: 'IMG_20260829_164011_637.webp', crop: { ...STORY_CROP, height: 620 }, widths: [480, 548] },
  { key: 'personalizado-tee-sacola', file: 'IMG-20260708-WA0010(1).jpg', widths: [480, 800, 1244] },
  { key: 'sacola-rua', file: 'img_1788013265582.jpg', crop: { left: 503, top: 2, width: 363, height: 426 }, widths: [363] },
  { key: 'tees-brancas-rua', file: 'img_1788013265582.jpg', crop: { left: 503, top: 866, width: 363, height: 432 }, widths: [363] },
  { key: 'personalizacao-banner', file: 'file_0000000051948243be34b4173302469c.png', widths: [800, 1400, 1983] }
];

fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(icons, { recursive: true });
const manifest = {};

for (const image of IMAGES) {
  const source = sharp(path.join(originals, image.file)).rotate();
  const base = image.crop ? source.extract(image.crop) : source;
  const buffer = await base.toBuffer();
  const { width, height } = await sharp(buffer).metadata();
  for (const target of image.widths) {
    await sharp(buffer).resize({ width: Math.min(target, width), withoutEnlargement: true })
      .webp({ quality: 78, effort: 5 })
      .toFile(path.join(output, `${image.key}-${target}.webp`));
  }
  manifest[image.key] = { width, height, widths: image.widths };
  console.log(`✓ ${image.key} (${width}×${height})`);
}

// Ícones a partir do logótipo G7 (marca a branco sobre tinta).
const logo = await sharp(path.join(originals, 'IMG-20260617-WA0004.jpg'))
  .extract({ left: 450, top: 385, width: 590, height: 590 }).flatten({ background: '#ffffff' }).negate({ alpha: false }).toBuffer();
for (const size of [32, 180, 192, 512]) {
  await sharp(logo).resize(Math.round(size * 0.78)).extend({
    top: Math.round(size * 0.11), bottom: size - Math.round(size * 0.78) - Math.round(size * 0.11),
    left: Math.round(size * 0.11), right: size - Math.round(size * 0.78) - Math.round(size * 0.11), background: '#000000'
  }).png().toFile(path.join(icons, `icon-${size}.png`));
}
console.log('✓ ícones');

const banner = '// Gerado por scripts/optimize-images.js — não editar à mão.\n';
fs.writeFileSync(path.join(root, 'js/lib/image-manifest.js'), `${banner}export const IMAGE_MANIFEST = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`);
console.log('✓ js/lib/image-manifest.js');
