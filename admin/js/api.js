// Acesso a dados do painel (supabase-js). As permissões reais são garantidas no servidor por RLS
// (public.is_admin()); aqui só se lê/escreve com a sessão do administrador e a anon key.
import { SITE_CONFIG } from '/config/site.js';
import { ORDERS_PAGE_SIZE, UPLOAD, orderSearchFilter, uploadPath } from './logic.js';

export const ORDER_LIST_SELECT = 'id, order_number, customer_name, phone, total, status, created_at, order_items(quantity)';
const PRODUCT_LIST_SELECT = 'id, slug, name, category, product_type, tag, base_price, status, featured, created_at, product_images(image_url, position), product_variants(stock)';
const PRODUCT_SELECT = 'id, slug, name, description, category, product_type, base_price, status, featured, order_mode, tag, created_at, updated_at, '
  + 'product_images(id, image_url, alt_text, position, color), product_variants(id, color, size, stock, price_override, sku, position)';

// Uma escrita que devolve 0 linhas não falhou no PostgREST, mas não alterou nada (RLS ou registo apagado).
export function noRowsError() {
  return Object.assign(new Error('NO_ROWS'), { code: 'NO_ROWS' });
}

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function runPool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

export function createApi(supabase) {
  const storage = () => supabase.storage.from(UPLOAD.bucket);

  return {
    // ── Autenticação ──
    async isAdmin(userId) {
      const data = unwrap(await supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle());
      return Boolean(data);
    },

    // ── Dashboard ──
    async dashboard() {
      const threshold = SITE_CONFIG.lowStockThreshold;
      const head = { count: 'exact', head: true };
      // Variantes de produtos não arquivados.
      const variants = () => supabase.from('product_variants').select('id, products!inner(status)', head).neq('products.status', 'archived');
      const results = await Promise.all([
        supabase.from('products').select('id', head).eq('status', 'active'),
        supabase.from('orders').select('id', head).eq('status', 'novo'),
        variants().gte('stock', 1).lte('stock', threshold),
        variants().eq('stock', 0),
        variants().is('stock', null),
        supabase.from('orders').select(ORDER_LIST_SELECT).order('created_at', { ascending: false }).limit(5)
      ]);
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      const [active, fresh, low, out, unknown, recent] = results;
      return {
        activeProducts: active.count ?? 0,
        newOrders: fresh.count ?? 0,
        stock: { low: low.count ?? 0, out: out.count ?? 0, unknown: unknown.count ?? 0 },
        recentOrders: recent.data ?? []
      };
    },

    // ── Produtos ──
    async listProducts() {
      return unwrap(await supabase.from('products').select(PRODUCT_LIST_SELECT).order('created_at', { ascending: false, nullsFirst: false }).order('name'));
    },

    async getProduct(id) {
      return unwrap(await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).maybeSingle());
    },

    async insertProduct(row) {
      return unwrap(await supabase.from('products').insert(row).select('id').single());
    },

    async updateProduct(id, row) {
      const data = unwrap(await supabase.from('products').update(row).eq('id', id).select('id'));
      if (!data?.length) throw noRowsError();
      return data[0];
    },

    async deleteProduct(id) {
      const data = unwrap(await supabase.from('products').delete().eq('id', id).select('id'));
      if (!data?.length) throw noRowsError();
    },

    // Aplica um plano de planSync() a product_images ou product_variants.
    // Ordem: apagar → atualizar → inserir (liberta combinações cor+tamanho/SKU antes de as reutilizar).
    // As atualizações que colidem com uma restrição única são repetidas uma vez no fim (ex.: M→L e L→XL).
    async syncRows(table, productId, plan) {
      const result = { deleted: [], updated: [], inserted: [], failures: [] };
      if (plan.toDelete.length) {
        const { error } = await supabase.from(table).delete().eq('product_id', productId).in('id', plan.toDelete);
        if (error) result.failures.push({ op: 'delete', count: plan.toDelete.length, error });
        else result.deleted = [...plan.toDelete];
      }
      let pending = plan.toUpdate;
      for (let pass = 0; pass < 2 && pending.length; pass += 1) {
        const retry = [];
        for (const item of pending) {
          const { data, error } = await supabase.from(table).update(item.patch).eq('id', item.id).select('id');
          if (!error && data?.length) result.updated.push(item);
          else if (error?.code === '23505' && pass === 0) retry.push(item);
          else result.failures.push({ op: 'update', count: 1, key: item.key, error: error ?? noRowsError() });
        }
        pending = retry;
      }
      for (const item of plan.toInsert) {
        const { data, error } = await supabase.from(table).insert({ ...item.row, product_id: productId }).select('id').single();
        if (error) result.failures.push({ op: 'insert', count: 1, key: item.key, error });
        else result.inserted.push({ key: item.key, id: String(data.id), row: item.row });
      }
      return result;
    },

    // ── Storage ──
    async uploadImage(productId, file) {
      const path = uploadPath(productId, file.name, file.type);
      const { error } = await storage().upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      return { path, url: storage().getPublicUrl(path).data.publicUrl };
    },

    async removeStorageObjects(paths) {
      if (!paths.length) return;
      const { error } = await storage().remove(paths);
      if (error) throw error;
    },

    async removeProductFolder(productId) {
      const folder = `products/${productId}`;
      const { data, error } = await storage().list(folder, { limit: 1000 });
      if (error) throw error;
      const paths = (data ?? []).filter(item => item.name && item.id !== null).map(item => `${folder}/${item.name}`);
      if (paths.length) await this.removeStorageObjects(paths);
    },

    // ── Stock ──
    async stockProducts() {
      return unwrap(await supabase.from('products')
        .select('id, name, status, product_variants(id, color, size, stock, position)')
        .neq('status', 'archived')
        .order('name'));
    },

    // Atualiza product_variants.stock em lote (5 pedidos em paralelo). Devolve o que foi gravado e o que falhou.
    async updateVariantStocks(changes) {
      const saved = [];
      const failed = [];
      await runPool(changes, 5, async change => {
        const { data, error } = await supabase.from('product_variants').update({ stock: change.stock }).eq('id', change.id).select('id, stock');
        if (error || !data?.length) failed.push({ ...change, error: error ?? noRowsError() });
        else saved.push({ id: String(data[0].id), stock: data[0].stock ?? null });
      });
      return { saved, failed };
    },

    // ── Pedidos ──
    async listOrders({ status = '', q = '', page = 0 } = {}) {
      const from = page * ORDERS_PAGE_SIZE;
      let query = supabase.from('orders')
        .select(ORDER_LIST_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + ORDERS_PAGE_SIZE - 1);
      if (status) query = query.eq('status', status);
      const filter = orderSearchFilter(q);
      if (filter) query = query.or(filter);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? (data ?? []).length };
    },

    async getOrder(id) {
      return unwrap(await supabase.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle());
    },

    async updateOrderStatus(id, status) {
      const data = unwrap(await supabase.from('orders').update({ status }).eq('id', id).select('id, status'));
      if (!data?.length) throw noRowsError();
      return data[0];
    }
  };
}
