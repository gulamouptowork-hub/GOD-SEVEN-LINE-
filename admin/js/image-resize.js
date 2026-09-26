// Reduz fotografias no browser antes do upload para o Storage. A loja mostra estes URLs sem srcset, por isso um
// original de telemóvel (2–5 MB) seria descarregado até nas miniaturas do carrinho e da pesquisa.
// Lado maior até IMAGE_RESIZE.maxSide px, em WebP (Safari não codifica WebP: JPEG para fotografias JPEG).
// Sem suporte no browser, sem ganho de tamanho ou em qualquer erro, segue o ficheiro original.
import { IMAGE_RESIZE, resizePlan } from './logic.js';

const encode = (canvas, type) => new Promise(resolve => {
  canvas.toBlob(blob => resolve(blob?.type === type ? blob : null), type, IMAGE_RESIZE.quality);
});

export async function prepareImageUpload(file) {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap = null;
  try {
    // 'from-image' aplica a rotação EXIF das fotografias de telemóvel (um browser que não a conheça recusa a
    // opção e fica o original, em vez de uma imagem deitada).
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const plan = resizePlan({ width: bitmap.width, height: bitmap.height, size: file.size });
    if (!plan) return file;
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = await encode(canvas, IMAGE_RESIZE.type) ?? (file.type === 'image/jpeg' ? await encode(canvas, 'image/jpeg') : null);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } catch (error) {
    console.warn('Não foi possível reduzir a imagem; segue o original.', error);
    return file;
  } finally {
    bitmap?.close?.();
  }
}
