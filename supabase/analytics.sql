-- =====================================================================
-- God Seven Line — estatísticas de visitas (próprias e anónimas)
--
-- Como usar: Supabase → SQL Editor → New query → colar este ficheiro → Run.
-- Correr DEPOIS de supabase/schema.sql (usa is_admin() e a tabela orders).
-- Pode ser executado mais do que uma vez: não apaga tabelas nem dados.
--
-- O que se guarda por evento: tipo, data/hora, identificador aleatório do browser (visitante)
-- e da visita (sessão), caminho da página, slug do produto, origem (só o domínio ou utm_source)
-- e tipo de dispositivo. NÃO se guarda nome, telefone, IP, user-agent, texto livre nem cookies.
--
--  • A loja envia eventos só através de track_events() (validada e limitada no servidor).
--  • Ninguém lê a tabela diretamente: o painel usa analytics_report(), que exige is_admin().
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabela de eventos
-- ---------------------------------------------------------------------

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null,
  visitor_id uuid not null,
  session_id uuid not null,
  path text,
  product_slug text,
  referrer text,
  device text,
  constraint analytics_events_event_check check (event in ('page_view', 'view_product', 'add_to_cart', 'begin_checkout', 'whatsapp_checkout', 'whatsapp_click')),
  constraint analytics_events_path_check check (path is null or (char_length(path) <= 200 and left(path, 1) = '/')),
  constraint analytics_events_slug_check check (product_slug is null or (char_length(product_slug) <= 120 and product_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')),
  constraint analytics_events_referrer_check check (referrer is null or (char_length(referrer) <= 100 and referrer ~ '^[a-z0-9._-]+$')),
  constraint analytics_events_device_check check (device is null or device in ('mobile', 'tablet', 'desktop'))
);

create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_visitor_idx on public.analytics_events (visitor_id, created_at);

-- ---------------------------------------------------------------------
-- 2. track_events(): único caminho de escrita (loja → Supabase)
--    Recebe [{ event, visitor_id, session_id, path, product_slug, referrer, device }, …] (máx. 25).
--    Entradas inválidas são ignoradas (nunca dá erro à loja). A data/hora é sempre a do servidor.
--    Limites (travam abusos simples; não é anti-bot):
--      • 120 eventos por visitante em 10 minutos;
--      • no total da loja, 1.000 eventos por minuto e 30.000 em 24 horas. Como o identificador do
--        visitante vem do browser, este teto global é o que impede alguém de encher a base de dados
--        (e afetar os pedidos). Uma loja com milhares de visitas por dia fica muito abaixo dele.
--    Devolve quantos eventos foram gravados.
-- ---------------------------------------------------------------------

create or replace function public.track_events(p_events jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_event text;
  v_visitor uuid;
  v_session uuid;
  v_path text;
  v_slug text;
  v_referrer text;
  v_device text;
  v_recent integer;
  v_minute integer;
  v_day integer;
  v_saved integer := 0;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into v_minute, v_day
  from public.analytics_events
  where created_at > now() - interval '24 hours';
  if v_minute >= 1000 or v_day >= 30000 then
    return 0;
  end if;

  for v_item in
    select t.item from jsonb_array_elements(p_events) with ordinality as t(item, n) where t.n <= 25
  loop
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;

    v_event := v_item->>'event';
    if v_event is null or v_event not in ('page_view', 'view_product', 'add_to_cart', 'begin_checkout', 'whatsapp_checkout', 'whatsapp_click') then
      continue;
    end if;

    begin
      v_visitor := (v_item->>'visitor_id')::uuid;
      v_session := (v_item->>'session_id')::uuid;
    exception when others then
      continue;
    end;
    if v_visitor is null or v_session is null then
      continue;
    end if;

    select count(*) into v_recent
    from public.analytics_events
    where visitor_id = v_visitor and created_at > now() - interval '10 minutes';
    if v_recent >= 120 then
      continue;
    end if;
    if v_minute + v_saved >= 1000 or v_day + v_saved >= 30000 then
      exit;
    end if;

    v_path := nullif(v_item->>'path', '');
    if v_path is not null and (char_length(v_path) > 200 or left(v_path, 1) <> '/') then
      v_path := null;
    end if;

    v_slug := nullif(lower(v_item->>'product_slug'), '');
    if v_slug is not null and (char_length(v_slug) > 120 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
      v_slug := null;
    end if;

    v_referrer := nullif(lower(v_item->>'referrer'), '');
    if v_referrer is not null and (char_length(v_referrer) > 100 or v_referrer !~ '^[a-z0-9._-]+$') then
      v_referrer := null;
    end if;

    v_device := v_item->>'device';
    if v_device is not null and v_device not in ('mobile', 'tablet', 'desktop') then
      v_device := null;
    end if;

    insert into public.analytics_events (event, visitor_id, session_id, path, product_slug, referrer, device)
    values (v_event, v_visitor, v_session, v_path, v_slug, v_referrer, v_device);
    v_saved := v_saved + 1;
  end loop;

  return v_saved;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. analytics_totals(): contagens de um intervalo (uso interno do relatório)
-- ---------------------------------------------------------------------

create or replace function public.analytics_totals(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'visitors', count(distinct e.visitor_id),
    'sessions', count(distinct e.session_id),
    'page_views', count(*) filter (where e.event = 'page_view'),
    'product_views', count(*) filter (where e.event = 'view_product'),
    'add_to_cart', count(*) filter (where e.event = 'add_to_cart'),
    'begin_checkout', count(*) filter (where e.event = 'begin_checkout'),
    'whatsapp_orders', count(*) filter (where e.event = 'whatsapp_checkout'),
    'whatsapp_clicks', count(*) filter (where e.event = 'whatsapp_click'),
    'orders_registered', (
      select count(*) from public.orders o
      where o.created_at >= p_start and o.created_at < p_end and o.status <> 'cancelado'
    ),
    'funnel', jsonb_build_object(
      'visitors', count(distinct e.visitor_id),
      'viewed_product', count(distinct e.visitor_id) filter (where e.event = 'view_product'),
      'added_to_cart', count(distinct e.visitor_id) filter (where e.event = 'add_to_cart'),
      'began_checkout', count(distinct e.visitor_id) filter (where e.event = 'begin_checkout'),
      'sent_order', count(distinct e.visitor_id) filter (where e.event = 'whatsapp_checkout')
    )
  )
  from public.analytics_events e
  where e.created_at >= p_start and e.created_at < p_end;
$$;

-- ---------------------------------------------------------------------
-- 4. analytics_report(): tudo o que a página "Visitantes" do painel mostra, num só pedido.
--    p_from/p_to: datas locais (inclusive) no fuso p_tz. p_bucket: hour | day | week (seg.) | month.
--    "previous" compara com o intervalo anterior de igual duração; se o período inclui o momento
--    atual, compara só o tempo já decorrido (ex.: hoje até às 15h vs. ontem até às 15h).
-- ---------------------------------------------------------------------

create or replace function public.analytics_report(
  p_from date,
  p_to date,
  p_bucket text default 'day',
  p_tz text default 'Africa/Maputo'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_step interval;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_bucket is null or p_bucket not in ('hour', 'day', 'week', 'month') then
    raise exception 'INVALID_BUCKET' using errcode = '22023';
  end if;
  begin
    v_start := p_from::timestamp at time zone p_tz;
  exception when others then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023';
  end;

  v_end := (p_to + 1)::timestamp at time zone p_tz;
  v_prev_start := v_start - (v_end - v_start);
  v_prev_end := v_start;
  if v_end > now() then
    v_prev_end := v_prev_start + greatest(now() - v_start, interval '0');
  end if;
  v_step := case p_bucket
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  with ev as (
    select e.event, e.visitor_id, e.session_id, e.path, e.product_slug, e.referrer, e.device, e.created_at,
           date_trunc(p_bucket, e.created_at at time zone p_tz) as bucket
    from public.analytics_events e
    where e.created_at >= v_start and e.created_at < v_end
  ),
  buckets as (
    select generate_series(
      date_trunc(p_bucket, p_from::timestamp),
      date_trunc(p_bucket, (p_to + 1)::timestamp - interval '1 second'),
      v_step
    ) as bucket
  ),
  series as (
    select b.bucket,
      count(distinct ev.visitor_id) as visitors,
      count(ev.event) filter (where ev.event = 'page_view') as page_views,
      count(ev.event) filter (where ev.event = 'view_product') as product_views,
      count(ev.event) filter (where ev.event = 'add_to_cart') as add_to_cart,
      count(ev.event) filter (where ev.event = 'whatsapp_checkout') as whatsapp_orders
    from buckets b
    left join ev on ev.bucket = b.bucket
    group by b.bucket
  ),
  top_products as (
    select ev.product_slug as slug,
      count(*) filter (where ev.event = 'view_product') as views,
      count(distinct ev.visitor_id) filter (where ev.event = 'view_product') as visitors,
      count(*) filter (where ev.event = 'add_to_cart') as adds,
      count(*) filter (where ev.event = 'whatsapp_click') as whatsapp
    from ev
    where ev.product_slug is not null
    group by ev.product_slug
    order by views desc, adds desc, slug
    limit 10
  ),
  top_pages as (
    select ev.path, count(*) as views, count(distinct ev.visitor_id) as visitors
    from ev
    where ev.event = 'page_view' and ev.path is not null
    group by ev.path
    order by views desc, ev.path
    limit 10
  ),
  session_sources as (
    select ev.session_id, (array_agg(ev.referrer order by ev.created_at) filter (where ev.referrer is not null))[1] as source
    from ev
    group by ev.session_id
  ),
  sources as (
    select coalesce(s.source, '') as source, count(*) as sessions
    from session_sources s
    group by 1
    order by sessions desc, source
    limit 8
  ),
  devices as (
    select coalesce(ev.device, '') as device, count(distinct ev.visitor_id) as visitors
    from ev
    group by 1
    order by visitors desc, device
  ),
  hours as (
    select h.hour, count(ev.event) as page_views
    from generate_series(0, 23) as h(hour)
    left join ev on ev.event = 'page_view' and extract(hour from ev.created_at at time zone p_tz) = h.hour
    group by h.hour
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'bucket', p_bucket,
    'timezone', p_tz,
    'generated_at', now(),
    'live_visitors', (select count(distinct a.visitor_id) from public.analytics_events a where a.created_at > now() - interval '5 minutes'),
    'first_event_at', (select min(a.created_at) from public.analytics_events a),
    'totals', public.analytics_totals(v_start, v_end),
    'previous', public.analytics_totals(v_prev_start, v_prev_end),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(s.bucket, 'YYYY-MM-DD"T"HH24:MI'),
        'visitors', s.visitors, 'page_views', s.page_views, 'product_views', s.product_views,
        'add_to_cart', s.add_to_cart, 'whatsapp_orders', s.whatsapp_orders
      ) order by s.bucket), '[]'::jsonb) from series s),
    'top_products', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', t.slug, 'name', p.name, 'product_id', p.id, 'status', p.status,
        'views', t.views, 'visitors', t.visitors, 'adds', t.adds, 'whatsapp', t.whatsapp
      ) order by t.views desc, t.adds desc, t.slug), '[]'::jsonb)
      from top_products t left join public.products p on p.slug = t.slug),
    'top_pages', (select coalesce(jsonb_agg(jsonb_build_object('path', t.path, 'views', t.views, 'visitors', t.visitors)
      order by t.views desc, t.path), '[]'::jsonb) from top_pages t),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'sessions', s.sessions)
      order by s.sessions desc, s.source), '[]'::jsonb) from sources s),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', d.device, 'visitors', d.visitors)
      order by d.visitors desc, d.device), '[]'::jsonb) from devices d),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'page_views', h.page_views)
      order by h.hour), '[]'::jsonb) from hours h)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Permissões
--    O Supabase dá acesso a anon/authenticated por omissão: retirar tudo e dar só o necessário.
-- ---------------------------------------------------------------------

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on sequence public.analytics_events_id_seq from public, anon, authenticated;

revoke all on function public.track_events(jsonb) from public, anon, authenticated;
grant execute on function public.track_events(jsonb) to anon, authenticated;

revoke all on function public.analytics_totals(timestamptz, timestamptz) from public, anon, authenticated;

revoke all on function public.analytics_report(date, date, text, text) from public, anon, authenticated;
grant execute on function public.analytics_report(date, date, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------
-- Manutenção (opcional, correr à mão quando quiseres): apagar eventos com mais de 13 meses.
--   delete from public.analytics_events where created_at < now() - interval '13 months';
-- ---------------------------------------------------------------------
