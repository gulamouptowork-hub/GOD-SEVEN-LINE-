# Arquitetura — God Seven Line

Site estático gerado por Node (sem framework, sem dependências de runtime) e publicado na Vercel.
O catálogo, o pedido e a mensagem WhatsApp funcionam em dois modos:

| Modo | Quando | Produtos | Pedidos |
|---|---|---|---|
| **Local** | `SUPABASE_URL`/`SUPABASE_ANON_KEY` não definidos | `data/products.json` | ID temporário `GSL-AAMMDD-XXXX`, guardado só no dispositivo |
| **Supabase** | variáveis definidas no build | tabelas `products`, `product_images`, `product_variants` | RPC `create_order` → `GSL-0047` sequencial, revalidado no servidor |

## Estrutura

```
config/site.js           Configuração central (marca, WhatsApp, categorias, tamanhos, entrega, limites de stock)
config/runtime.js        Gerado no build a partir do ambiente (Supabase URL + anon key, WHATSAPP_NUMBER, demo)
data/products.json       Catálogo do modo local e fonte das páginas estáticas nesse modo (publicado só com os ativos)
assets/originals/        Fotografias originais (não publicadas)
assets/images/           WebP responsivos gerados por `npm run images`
js/lib/                  Lógica pura partilhada por browser, build e testes
  format.js              formatPrice(1250) → "1.250 MT", datas
  catalog.js             Modelo de produto, variantes, disponibilidade, filtros, ordenação
  cart.js                Regras do pedido (add/quantidade/remover/reconciliar/totais)
  order.js               Rascunho do pedido (snapshots)
  validation.js          Telefone (MZ + internacional), dados do cliente
  order-number.js        GSL-0047 (backend) / GSL-AAMMDD-XXXX (local)
  whatsapp.js            Mensagem estruturada + URL wa.me com encodeURIComponent
  images.js              Chave de imagem → src/srcset
js/store/cart-store.js   Fonte única do pedido no browser (localStorage + sync entre separadores)
js/services/             runtime, cliente REST Supabase, products, orders
js/ui/, js/pages/        Comportamento da loja pública (header, gaveta, pesquisa, catálogo, produto, checkout)
js/ui/templates.js       Templates HTML partilhados entre build (SSG) e browser
styles/                  god-seven.css (identidade existente) + store.css (camada comercial)
admin/                   Painel /admin (visual próprio, supabase-js, autenticação)
supabase/                schema.sql (tabelas, RLS, RPC), seed.sql (gerado)
scripts/                 build, serve (dev), optimize-images, generate-seed
tests/                   node:test
```

## Modelo de produto (JS, camelCase)

```js
{
  id, slug, name,
  category,        // 't-shirts' | 'polos' | 'hoodies' | 'acessorios' | 'personalizacao'
  productType,     // subtítulo do cartão, ex. "Polo"
  description,
  basePrice,       // inteiro MZN ou null (sem preço → "Preço sob consulta")
  status,          // 'active' | 'draft' | 'archived'
  featured,        // aparece no NEW DROP da homepage
  orderMode,       // 'cart' (pedido normal) | 'custom' (personalização via WhatsApp)
  tag,             // etiqueta editorial opcional (ex. "SIGNATURE")
  createdAt, updatedAt,
  images:   [{ src, alt, color }],            // src = chave de assets/images OU URL completo
  variants: [{ id, color, size, stock, priceOverride, sku }]  // size null = tamanho único
}
```

* Preço final de uma variante: `priceOverride ?? basePrice`.
* Uma variante só é vendável com preço ≥ 0 **e** stock inteiro conhecido. `stock = 0` → esgotado; `stock ≤ 3` → "Últimas N unidades".
* Produto: stock total ≤ 5 → etiqueta ÚLTIMAS UNIDADES; criado há ≤ 30 dias → NOVO.

## Base de dados (Supabase / Postgres, snake_case)

```
products          id uuid pk, slug text unique, name, description, category, product_type,
                  base_price integer null (>=0), status ('active'|'draft'|'archived'), featured bool,
                  order_mode ('cart'|'custom'), tag, created_at (null = data de lançamento desconhecida → sem NOVO;
                  ordenar sempre com nulls last), updated_at
product_images    id uuid pk, product_id fk→products (cascade), image_url, alt_text, position int, color null
product_variants  id uuid pk, product_id fk→products (cascade), color text, size text null,
                  stock integer null (>=0), price_override integer null (>=0), sku text unique null,
                  position int, unique (product_id, color, size) nulls not distinct
orders            id uuid pk, order_number text unique (GSL-0001…), customer_name, phone, location,
                  delivery_type ('levantamento'|'entrega'), notes, subtotal int, delivery_fee int null,
                  total int, status ('novo'|'confirmado'|'em_preparacao'|'concluido'|'cancelado'),
                  created_at, updated_at
order_items       id uuid pk, order_id fk→orders (cascade), product_id fk (set null), variant_id fk (set null),
                  product_name_snapshot, size_snapshot, color_snapshot, unit_price int, quantity int>0, subtotal int
admin_users       user_id uuid pk fk→auth.users, email, created_at
```

`public.create_order(p_customer jsonb, p_items jsonb, p_expected_total integer)` — `security definer`,
executável por `anon`. Recebe `{name, phone, location, delivery_type, notes}` e `[{variant_id, quantity}]`,
bloqueia as variantes (`for update`), valida produto ativo, `order_mode = 'cart'`, preço e stock, calcula os
totais **no servidor** (ignora preços do cliente), grava `orders` + `order_items` com snapshots e devolve
`(order_id, order_number, subtotal, total, created_at)`. Erros: `raise exception '<CÓDIGO>'` com `detail`
legível — `EMPTY_ORDER`, `TOO_MANY_ITEMS`, `INVALID_CUSTOMER`, `INVALID_ITEM`, `PRODUCT_UNAVAILABLE`,
`STOCK_INSUFFICIENT`, `PRICE_CHANGED` (quando `p_expected_total` difere do total calculado).
O stock **não** é descontado automaticamente: é gerido no admin (decisão de negócio pendente).

RLS: leitura pública apenas de produtos `active` (e respetivas imagens/variantes); escrita e leitura de
pedidos só para `public.is_admin()` (utilizador autenticado presente em `admin_users`). Storage: bucket
público `product-images`, escrita só para admins.

## Fluxo do pedido

```
Produto → cor → tamanho → quantidade → ADICIONAR AO PEDIDO (valida variante/stock)
  → cart-store (localStorage) → gaveta O TEU PEDIDO → /finalizar
  → 1 Dados (validação) → 2 Resumo → [revalida catálogo fresco + create_order]
  → 3 WhatsApp (mensagem gerada e aberta; pedido limpo; última encomenda guardada para reabrir)
```

## Analytics

`js/analytics.js` → `track(evento, dados)` emite `gsl:analytics` e alimenta `window.dataLayer` se existir.
Eventos: `page_view`, `view_product`, `select_size`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `whatsapp_checkout`, `whatsapp_click`.
Com o Supabase configurado, os eventos de `SERVER_EVENTS` (`js/lib/analytics.js`) vão em lotes anónimos para
`track_events` (`supabase/analytics.sql`); o painel lê-os só por `analytics_report` (admin). Não envia nada no
modo demo, com Do Not Track / GPC, em browsers automatizados, no browser de quem entra no `/admin` nem quando o
browser não deixa guardar o identificador.
