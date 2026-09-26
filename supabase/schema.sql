-- =====================================================================
-- God Seven Line — esquema da base de dados (Supabase / Postgres 15+)
--
-- Como usar: Supabase → SQL Editor → New query → colar este ficheiro → Run.
-- Pode ser executado mais do que uma vez: não apaga tabelas nem dados.
-- Contrato: docs/ARCHITECTURE.md. Depois deste ficheiro, correr supabase/seed.sql.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Utilitários: updated_at automático e numeração dos pedidos
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Números de pedido sequenciais: GSL-0001, GSL-0002, … (a partir de GSL-10000 cresce sem truncar).
-- Um pedido rejeitado não consome número; podem existir falhas pontuais na sequência (normal em Postgres).
create sequence if not exists public.order_number_seq start with 1 increment by 1 minvalue 1;

create or replace function public.next_order_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'GSL-' || lpad(seq.n::text, greatest(4, char_length(seq.n::text)), '0')
  from (select nextval('public.order_number_seq') as n) as seq;
$$;

-- ---------------------------------------------------------------------
-- 2. Catálogo: produtos, imagens e variantes (cor × tamanho)
-- ---------------------------------------------------------------------

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  name         text not null,
  description  text not null default '',
  category     text not null,
  product_type text not null default '',
  base_price   integer,                     -- MZN inteiro; null = "Preço sob consulta"
  status       text not null default 'draft',
  featured     boolean not null default false,
  order_mode   text not null default 'cart',
  tag          text,
  -- Pode ser null nas peças do catálogo original (data de lançamento desconhecida → sem etiqueta NOVO).
  -- Por isso, quem ordena por created_at tem de usar NULLS LAST (PostgREST: order=created_at.desc.nullslast),
  -- senão essas peças aparecem sempre antes das criadas no /admin.
  created_at   timestamptz default now(),
  updated_at   timestamptz not null default now(),
  constraint products_slug_key unique (slug),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_name_not_blank check (char_length(btrim(name)) > 0),
  constraint products_category_check check (category in ('t-shirts', 'polos', 'hoodies', 'acessorios', 'personalizacao')),
  constraint products_base_price_check check (base_price is null or base_price >= 0),
  constraint products_status_check check (status in ('active', 'draft', 'archived')),
  constraint products_order_mode_check check (order_mode in ('cart', 'custom'))
);

create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  image_url  text not null,                 -- chave de assets/images (ex. 'tee-verde-modelo') ou URL completo
  alt_text   text not null default '',
  position   integer not null default 0,
  color      text,                          -- null = imagem de todas as cores
  constraint product_images_url_not_blank check (char_length(btrim(image_url)) > 0),
  constraint product_images_position_check check (position >= 0)
);

create table if not exists public.product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  color          text not null,
  size           text,                      -- null = tamanho único
  stock          integer,                   -- null = stock ainda não definido (variante não vendável)
  price_override integer,                   -- null = usa products.base_price
  sku            text,
  position       integer not null default 0,
  constraint product_variants_color_not_blank check (char_length(btrim(color)) > 0),
  constraint product_variants_size_not_blank check (size is null or char_length(btrim(size)) > 0),
  constraint product_variants_stock_check check (stock is null or stock >= 0),
  constraint product_variants_price_override_check check (price_override is null or price_override >= 0),
  constraint product_variants_sku_not_blank check (sku is null or char_length(btrim(sku)) > 0),
  constraint product_variants_position_check check (position >= 0),
  constraint product_variants_sku_key unique (sku),
  constraint product_variants_option_key unique nulls not distinct (product_id, color, size)
);

-- ---------------------------------------------------------------------
-- 3. Pedidos e linhas do pedido (com snapshots de nome, cor, tamanho e preço)
-- ---------------------------------------------------------------------

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null default public.next_order_number(),
  customer_name text not null,
  phone         text not null,
  location      text,
  delivery_type text not null,
  notes         text,
  subtotal      integer not null,
  delivery_fee  integer,                    -- null = sem taxa configurada (combinada pelo WhatsApp)
  total         integer not null,
  status        text not null default 'novo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_order_number_key unique (order_number),
  constraint orders_customer_name_check check (char_length(customer_name) between 2 and 80),
  constraint orders_phone_check check (char_length(phone) between 8 and 32),
  constraint orders_location_check check (location is null or char_length(location) <= 120),
  constraint orders_delivery_type_check check (delivery_type in ('levantamento', 'entrega')),
  constraint orders_notes_check check (notes is null or char_length(notes) <= 500),
  constraint orders_subtotal_check check (subtotal >= 0),
  constraint orders_delivery_fee_check check (delivery_fee is null or delivery_fee >= 0),
  constraint orders_total_check check (total >= 0),
  constraint orders_status_check check (status in ('novo', 'confirmado', 'em_preparacao', 'concluido', 'cancelado'))
);

create table if not exists public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  product_id            uuid references public.products (id) on delete set null,
  variant_id            uuid references public.product_variants (id) on delete set null,
  product_name_snapshot text not null,
  size_snapshot         text,
  color_snapshot        text,
  unit_price            integer not null,
  quantity              integer not null,
  subtotal              integer not null,
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_subtotal_check check (subtotal >= 0 and subtotal::bigint = unit_price::bigint * quantity)
);

-- ---------------------------------------------------------------------
-- 4. Administradores (geridos só pelo SQL Editor — ver docs/SETUP.md)
-- ---------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

comment on table public.products is 'Catálogo God Seven Line. Leitura pública só de produtos active.';
comment on table public.product_variants is 'Cor × tamanho. Vendável só com preço (price_override ou base_price) e stock definidos.';
comment on table public.orders is 'Pedidos criados pela função create_order. Stock não é descontado automaticamente.';
comment on table public.admin_users is 'Utilizadores com acesso ao /admin. Inserir pelo SQL Editor.';

-- ---------------------------------------------------------------------
-- 5. Índices
-- ---------------------------------------------------------------------

create index if not exists products_status_idx on public.products (status);
create index if not exists product_images_product_id_idx on public.product_images (product_id, position);
create index if not exists product_variants_product_id_idx on public.product_variants (product_id, position);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists order_items_variant_id_idx on public.order_items (variant_id);

-- ---------------------------------------------------------------------
-- 6. Triggers de updated_at
-- ---------------------------------------------------------------------

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7. is_admin(): o utilizador autenticado está em admin_users E entrou com o código da app de
--    autenticação (verificação em dois passos: a sessão tem aal = 'aal2')?
--    Só com a palavra-passe (aal1) nenhuma regra de administrador se aplica: não lê pedidos nem altera nada.
--    security definer para ler admin_users sem depender das políticas RLS.
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 8. create_order(): único caminho para criar pedidos a partir da loja.
--    Valida cliente e linhas, bloqueia as variantes, recalcula preços e totais
--    no servidor e grava orders + order_items. NÃO desconta stock.
--    Erros: raise exception '<CÓDIGO>' (chega ao browser como "message").
-- ---------------------------------------------------------------------

create or replace function public.create_order(
  p_customer jsonb,
  p_items jsonb,
  p_expected_total integer default null
)
returns table (
  order_id     uuid,
  order_number text,
  subtotal     integer,
  total        integer,
  created_at   timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_max_lines    constant integer := 50;
  c_max_int      constant bigint := 2147483647;
  v_name         text;
  v_phone        text;
  v_location     text;
  v_delivery     text;
  v_notes        text;
  v_line_count   integer;
  v_item         jsonb;
  v_variant_raw  text;
  v_quantity_raw text;
  v_variant_id   uuid;
  v_quantity     integer;
  v_index        integer;
  v_ids          uuid[] := '{}';
  v_quantities   integer[] := '{}';
  v_row          record;
  v_label        text;
  v_price        integer;
  v_product_ids  uuid[] := '{}';
  v_names        text[] := '{}';
  v_colors       text[] := '{}';
  v_sizes        text[] := '{}';
  v_prices       integer[] := '{}';
  v_subtotal     bigint := 0;
  v_total        bigint;
  v_order_id     uuid;
  v_order_number text;
  v_created_at   timestamptz;
begin
  -- Cliente ------------------------------------------------------------
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'INVALID_CUSTOMER' using detail = 'Faltam os dados do cliente.';
  end if;

  v_name     := btrim(regexp_replace(coalesce(p_customer ->> 'name', ''), '\s+', ' ', 'g'));
  v_phone    := btrim(regexp_replace(coalesce(p_customer ->> 'phone', ''), '\s+', ' ', 'g'));
  v_location := nullif(btrim(regexp_replace(coalesce(p_customer ->> 'location', ''), '\s+', ' ', 'g')), '');
  v_delivery := coalesce(p_customer ->> 'delivery_type', '');
  v_notes    := nullif(regexp_replace(coalesce(p_customer ->> 'notes', ''), '^\s+|\s+$', '', 'g'), '');

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'INVALID_CUSTOMER' using detail = 'Indica o teu nome (2 a 80 caracteres).';
  end if;
  -- Conta os dígitos sem o prefixo internacional "00" (igual a js/lib/validation.js).
  if (char_length(regexp_replace(regexp_replace(v_phone, '\D', '', 'g'), '^00', '')) not between 8 and 15) or char_length(v_phone) > 32 then
    raise exception 'INVALID_CUSTOMER' using detail = 'Número de telefone inválido.';
  end if;
  if v_delivery not in ('levantamento', 'entrega') then
    raise exception 'INVALID_CUSTOMER' using detail = 'Escolhe a forma de entrega: levantamento ou entrega.';
  end if;
  if v_delivery = 'entrega' and v_location is null then
    raise exception 'INVALID_CUSTOMER' using detail = 'Indica a localização ou bairro para a entrega.';
  end if;
  if v_location is not null and char_length(v_location) > 120 then
    raise exception 'INVALID_CUSTOMER' using detail = 'A localização pode ter no máximo 120 caracteres.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'INVALID_CUSTOMER' using detail = 'As observações podem ter no máximo 500 caracteres.';
  end if;

  -- Linhas: lista não vazia, no máximo 50 ----------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'EMPTY_ORDER' using detail = 'O pedido não tem peças.';
  end if;
  v_line_count := jsonb_array_length(p_items);
  if v_line_count = 0 then
    raise exception 'EMPTY_ORDER' using detail = 'O pedido não tem peças.';
  end if;
  if v_line_count > c_max_lines then
    raise exception 'TOO_MANY_ITEMS' using detail = format('O pedido pode ter no máximo %s linhas.', c_max_lines);
  end if;

  -- Cada linha: variant_id (uuid) + quantity inteira 1..999.
  -- O uuid é validado por regex antes do cast, para nunca gerar um erro de conversão.
  -- Linhas repetidas da mesma variante são somadas.
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'INVALID_ITEM' using detail = 'Linha do pedido inválida.';
    end if;
    v_variant_raw  := btrim(coalesce(v_item ->> 'variant_id', ''));
    v_quantity_raw := btrim(coalesce(v_item ->> 'quantity', ''));
    if v_variant_raw !~ c_uuid_pattern then
      raise exception 'INVALID_ITEM' using detail = 'Peça sem identificador válido.';
    end if;
    if v_quantity_raw !~ '^[0-9]{1,3}$' then
      raise exception 'INVALID_ITEM' using detail = 'Quantidade inválida (1 a 999).';
    end if;
    v_variant_id := v_variant_raw::uuid;
    v_quantity   := v_quantity_raw::integer;
    if v_quantity < 1 then
      raise exception 'INVALID_ITEM' using detail = 'Quantidade inválida (1 a 999).';
    end if;

    v_index := array_position(v_ids, v_variant_id);
    if v_index is null then
      v_ids        := array_append(v_ids, v_variant_id);
      v_quantities := array_append(v_quantities, v_quantity);
    else
      v_quantities[v_index] := v_quantities[v_index] + v_quantity;
    end if;
  end loop;

  -- Bloqueia as variantes (ordem fixa por id, para evitar deadlocks entre pedidos simultâneos).
  perform 1
  from public.product_variants pv
  where pv.id = any (v_ids)
  order by pv.id
  for update;

  -- Revalidação: produto ativo, pedido normal, preço e stock definidos, stock suficiente.
  for i in 1 .. array_length(v_ids, 1) loop
    select pv.color, pv.size, pv.stock, pv.price_override,
           p.id as product_id, p.name as product_name, p.status as product_status,
           p.order_mode as product_order_mode, p.base_price as product_base_price
      into v_row
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_ids[i];

    if not found then
      raise exception 'PRODUCT_UNAVAILABLE' using detail = 'Uma das peças do pedido já não existe no catálogo.';
    end if;

    v_label := v_row.product_name || ' (' || v_row.color || coalesce(', ' || v_row.size, '') || ')';

    if v_row.product_status <> 'active' or v_row.product_order_mode <> 'cart' then
      raise exception 'PRODUCT_UNAVAILABLE' using detail = format('%s já não está disponível para encomenda.', v_label);
    end if;

    v_price := coalesce(v_row.price_override, v_row.product_base_price);
    if v_price is null or v_row.stock is null then
      raise exception 'PRODUCT_UNAVAILABLE' using detail = format('%s ainda não tem preço ou stock definido.', v_label);
    end if;

    if v_quantities[i] > v_row.stock then
      raise exception 'STOCK_INSUFFICIENT' using detail = case
        when v_row.stock = 0 then format('%s: sem stock disponível.', v_label)
        when v_row.stock = 1 then format('%s: só resta 1 unidade disponível.', v_label)
        else format('%s: só há %s unidades disponíveis.', v_label, v_row.stock)
      end;
    end if;

    v_subtotal    := v_subtotal + v_price::bigint * v_quantities[i];
    v_product_ids := array_append(v_product_ids, v_row.product_id);
    v_names       := array_append(v_names, v_row.product_name);
    v_colors      := array_append(v_colors, v_row.color);
    v_sizes       := array_append(v_sizes, v_row.size);
    v_prices      := array_append(v_prices, v_price);
  end loop;

  if v_subtotal > c_max_int then
    raise exception 'INVALID_ITEM' using detail = 'O total do pedido excede o limite permitido.';
  end if;

  -- Sem taxas de entrega configuradas: delivery_fee = null e total = subtotal.
  v_total := v_subtotal;

  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'PRICE_CHANGED' using detail = format(
      'O total atual do pedido é %s MT.',
      regexp_replace(v_total::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
    );
  end if;

  -- Gravação ------------------------------------------------------------
  insert into public.orders as o
    (customer_name, phone, location, delivery_type, notes, subtotal, delivery_fee, total, status)
  values
    (v_name, v_phone, v_location, v_delivery, v_notes, v_subtotal::integer, null, v_total::integer, 'novo')
  returning o.id, o.order_number, o.created_at
    into v_order_id, v_order_number, v_created_at;

  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.order_items
      (order_id, product_id, variant_id, product_name_snapshot, size_snapshot, color_snapshot,
       unit_price, quantity, subtotal)
    values
      (v_order_id, v_product_ids[i], v_ids[i], v_names[i], v_sizes[i], v_colors[i],
       v_prices[i], v_quantities[i], v_prices[i] * v_quantities[i]);
  end loop;

  return query
    select v_order_id, v_order_number, v_subtotal::integer, v_total::integer, v_created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Permissões de funções
--    O Supabase dá EXECUTE a anon/authenticated por omissão: retirar e dar só o necessário.
-- ---------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.next_order_number() from public, anon, authenticated;
revoke all on sequence public.order_number_seq from public, anon, authenticated;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

revoke all on function public.create_order(jsonb, jsonb, integer) from public;
grant execute on function public.create_order(jsonb, jsonb, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Permissões de tabelas (mínimas; o RLS decide linha a linha)
--     anon: só leitura do catálogo. Pedidos só via create_order.
-- ---------------------------------------------------------------------

revoke all on table
  public.products, public.product_images, public.product_variants,
  public.orders, public.order_items, public.admin_users
  from anon, authenticated;

grant select on table public.products, public.product_images, public.product_variants to anon;
grant select, insert, update, delete on table public.products, public.product_images, public.product_variants to authenticated;
grant select, update, delete on table public.orders, public.order_items to authenticated;
grant select on table public.admin_users to authenticated;

-- ---------------------------------------------------------------------
-- 11. Row Level Security
-- ---------------------------------------------------------------------

alter table public.products         enable row level security;
alter table public.product_images   enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.admin_users      enable row level security;

-- Produtos: público vê os ativos; admins veem e editam tudo.
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products
  for select to anon, authenticated
  using (status = 'active' or (select public.is_admin()));

drop policy if exists "products_insert_admin" on public.products;
create policy "products_insert_admin" on public.products
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "products_update_admin" on public.products;
create policy "products_update_admin" on public.products
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin" on public.products
  for delete to authenticated
  using ((select public.is_admin()));

-- Imagens: seguem o estado do produto.
drop policy if exists "product_images_select" on public.product_images;
create policy "product_images_select" on public.product_images
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_images.product_id and p.status = 'active')
    or (select public.is_admin())
  );

drop policy if exists "product_images_insert_admin" on public.product_images;
create policy "product_images_insert_admin" on public.product_images
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "product_images_update_admin" on public.product_images;
create policy "product_images_update_admin" on public.product_images
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "product_images_delete_admin" on public.product_images;
create policy "product_images_delete_admin" on public.product_images
  for delete to authenticated
  using ((select public.is_admin()));

-- Variantes: seguem o estado do produto.
drop policy if exists "product_variants_select" on public.product_variants;
create policy "product_variants_select" on public.product_variants
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_variants.product_id and p.status = 'active')
    or (select public.is_admin())
  );

drop policy if exists "product_variants_insert_admin" on public.product_variants;
create policy "product_variants_insert_admin" on public.product_variants
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "product_variants_update_admin" on public.product_variants;
create policy "product_variants_update_admin" on public.product_variants
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "product_variants_delete_admin" on public.product_variants;
create policy "product_variants_delete_admin" on public.product_variants
  for delete to authenticated
  using ((select public.is_admin()));

-- Pedidos: só admins leem, alteram e apagam. Sem política de insert (só via create_order).
drop policy if exists "orders_select_admin" on public.orders;
create policy "orders_select_admin" on public.orders
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin" on public.orders
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "orders_delete_admin" on public.orders;
create policy "orders_delete_admin" on public.orders
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "order_items_select_admin" on public.order_items;
create policy "order_items_select_admin" on public.order_items
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "order_items_update_admin" on public.order_items;
create policy "order_items_update_admin" on public.order_items
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "order_items_delete_admin" on public.order_items;
create policy "order_items_delete_admin" on public.order_items
  for delete to authenticated
  using ((select public.is_admin()));

-- Admins: cada utilizador vê apenas a sua própria linha. Inserir/remover só pelo SQL Editor.
drop policy if exists "admin_users_select_own" on public.admin_users;
create policy "admin_users_select_own" on public.admin_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 12. Storage: bucket público 'product-images' (fotografias carregadas no /admin)
--     Bucket público: cada ficheiro abre-se por URL (/storage/v1/object/public/…, que não passa
--     pelo RLS), mas NÃO se pode listar nem ler pela API sem ser admin — assim as fotografias de
--     produtos em rascunho não ficam à vista de quem tem a anon key.
--     Listar/ler pela API, carregar, substituir e apagar: só admins. Máx. 10 MB, só imagens.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

-- Versões anteriores deste script permitiam listar o bucket a anon; removida ao voltar a correr.
drop policy if exists "gsl_product_images_public_read" on storage.objects;
drop policy if exists "gsl_product_images_admin_read" on storage.objects;
create policy "gsl_product_images_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists "gsl_product_images_admin_insert" on storage.objects;
create policy "gsl_product_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists "gsl_product_images_admin_update" on storage.objects;
create policy "gsl_product_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()))
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists "gsl_product_images_admin_delete" on storage.objects;
create policy "gsl_product_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

commit;

select 'Esquema God Seven Line instalado. Próximo passo: correr supabase/seed.sql.' as resultado;
