// Fonte de produtos: Supabase (quando configurado) ou data/products.json (modo local).
import { normalizeProduct } from '../lib/catalog.js';
import { hasBackend } from './runtime.js';
import { ServiceError, supabaseRequest } from './supabase-rest.js';

const SELECT = [
  'id', 'slug', 'name', 'description', 'category', 'product_type', 'base_price', 'status', 'featured',
  'order_mode', 'tag', 'created_at', 'updated_at',
  'product_images(image_url,alt_text,position,color)',
  'product_variants(id,color,size,stock,price_override,sku,position)'
].join(',');

// Linha do Supabase (snake_case) → modelo normalizado.
export function mapSupabaseProduct(row) {
  return normalizeProduct({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    productType: row.product_type,
    basePrice: row.base_price,
    status: row.status,
    featured: row.featured,
    orderMode: row.order_mode,
    tag: row.tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    images: (row.product_images ?? []).map(image => ({ src: image.image_url, alt: image.alt_text, position: image.position, color: image.color })),
    variants: (row.product_variants ?? []).map(variant => ({
      id: variant.id, color: variant.color, size: variant.size, stock: variant.stock,
      priceOverride: variant.price_override, sku: variant.sku, position: variant.position
    }))
  });
}

async function fetchLocal({ fresh }) {
  let response;
  try {
    response = await fetch('/data/products.json', { cache: fresh ? 'no-store' : 'default' });
  } catch {
    throw new ServiceError('NETWORK', 'Sem ligação. Verifica a tua internet.');
  }
  if (!response.ok) throw new ServiceError(`HTTP_${response.status}`, 'Não foi possível carregar os produtos.');
  const data = await response.json();
  return data.map(normalizeProduct);
}

async function fetchRemote() {
  const rows = await supabaseRequest(`products?select=${SELECT}&status=eq.active&order=created_at.desc.nullslast,name.asc`);
  return rows.map(mapSupabaseProduct);
}

let cache = null;

// Devolve apenas produtos ativos. fresh=true ignora a cache (usado antes de finalizar o pedido).
export function loadProducts({ fresh = false } = {}) {
  if (!cache || fresh) {
    const request = (hasBackend ? fetchRemote() : fetchLocal({ fresh }))
      .then(products => products.filter(product => product.status === 'active'));
    request.catch(() => { if (cache === request) cache = null; });
    cache = request;
  }
  return cache;
}
