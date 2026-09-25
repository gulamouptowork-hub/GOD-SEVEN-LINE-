import { IMAGE_MANIFEST } from './image-manifest.js';
import { attrs } from './html.js';

// Uma imagem pode ser uma chave de assets/images (gerada por npm run images) ou um URL completo
// (por exemplo, uma imagem carregada no Supabase Storage pelo admin).
export function resolveImage(ref) {
  const key = String(ref ?? '');
  const entry = IMAGE_MANIFEST[key];
  if (!entry) return { src: key, srcset: '', width: null, height: null };
  const widths = [...entry.widths].sort((a, b) => a - b);
  const url = width => `/assets/images/${key}-${width}.webp`;
  const fallback = widths.find(width => width >= 800) ?? widths[widths.length - 1];
  return {
    src: url(fallback),
    srcset: widths.map(width => `${url(width)} ${Math.min(width, entry.width)}w`).join(', '),
    width: entry.width,
    height: entry.height
  };
}

export function absoluteImageURL(ref, siteUrl) {
  const { src } = resolveImage(ref);
  return /^https?:\/\//.test(src) ? src : `${siteUrl.replace(/\/$/, '')}${src}`;
}

export function imgHTML(ref, { alt = '', sizes = '100vw', className = '', loading = 'lazy', fetchpriority = null, decoding = 'async' } = {}) {
  const image = resolveImage(ref);
  if (!image.src) return '';
  return `<img${attrs({
    class: className || null,
    src: image.src,
    srcset: image.srcset || null,
    sizes: image.srcset ? sizes : null,
    width: image.width,
    height: image.height,
    alt,
    loading,
    fetchpriority,
    decoding
  })}>`;
}
