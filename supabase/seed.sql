-- =====================================================================
-- God Seven Line — dados iniciais do catálogo (seed)
--
-- FICHEIRO GERADO por scripts/generate-seed.js a partir de data/products.json.
-- Não editar à mão. Para regenerar:  node scripts/generate-seed.js
--
-- Como usar: correr DEPOIS de supabase/schema.sql, no SQL Editor do Supabase.
-- Preços e stock que estão null em data/products.json ficam null ("Preço sob consulta").
--
-- ATENÇÃO: pode ser executado mais do que uma vez, mas cada execução repõe os valores de
-- data/products.json nestes produtos (preço base, estado, descrição…) e APAGA e volta a criar
-- as suas imagens e variantes — o stock e os preços por variante definidos no /admin perdem-se.
-- Depois de começares a gerir o catálogo no /admin, não voltes a correr este ficheiro.
-- =====================================================================

begin;

-- Produtos: insere ou atualiza pelo slug (created_at existente mantém-se).
insert into public.products as p
  (slug, name, description, category, product_type, base_price, status, featured, order_mode, tag, created_at)
values
  ('t-shirt-seven', 'T-shirt Seven', 'T-shirt verde com a assinatura seVen LINE bordada ao peito. Uma peça para fazer parte da tua história.', 't-shirts', 'T-shirt', null, 'active', true, 'cart', 'ESSENCIAL', null),
  ('polo-seven', 'Polo Seven', 'Polo com identidade Seven: bordado seVen ao peito e o número 3 na manga. Disponível em rosa e vermelho.', 'polos', 'Polo', null, 'active', true, 'cart', 'IDENTIDADE', null),
  ('seven-signature', 'Seven Signature', 'Polo preto da linha Signature, com estrelas e bordado seVen. Para um visual limpo e marcante.', 'polos', 'Polo', null, 'active', true, 'cart', 'SIGNATURE', null),
  ('seven-street-tee', 'Seven Street Tee', 'Streetwear God Seven Line com estampa de destaque nas costas e presença moçambicana.', 't-shirts', 'T-shirt', null, 'active', true, 'cart', 'STREET EDITION', null),
  ('a-tua-estampa', 'A tua estampa', 'T-shirts e sacolas personalizadas com a tua arte, frase ou ideia. Partilha a tua ideia e combinamos os detalhes contigo.', 'personalizacao', 'Peça personalizada', null, 'active', false, 'custom', 'FEITO À TUA MEDIDA', null),
  ('sacola-personalizada', 'Sacola Personalizada', 'A tua arte numa sacola resistente. Envia a ideia e nós tratamos da personalização.', 'acessorios', 'Sacola', null, 'active', false, 'custom', 'CRIA A TUA', null)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  product_type = excluded.product_type,
  base_price = excluded.base_price,
  status = excluded.status,
  featured = excluded.featured,
  order_mode = excluded.order_mode,
  tag = excluded.tag,
  created_at = coalesce(excluded.created_at, p.created_at);

-- Imagens: apaga as destes produtos e insere as de data/products.json (image_url = chave de assets/images).
delete from public.product_images where product_id in (select id from public.products where slug in (
  't-shirt-seven',
  'polo-seven',
  'seven-signature',
  'seven-street-tee',
  'a-tua-estampa',
  'sacola-personalizada'
));

insert into public.product_images (product_id, image_url, alt_text, position, color)
select p.id, v.image_url, v.alt_text, v.position::integer, v.color::text
from (values
  ('t-shirt-seven', 'tee-verde-modelo', 'T-shirt Seven verde vestida, vista de frente', 0, null),
  ('t-shirt-seven', 'tee-verde-detalhe', 'Detalhe do bordado seVen LINE na T-shirt Seven verde', 1, null),
  ('polo-seven', 'polos-rosa-vermelho', 'Duas jovens com polos Seven rosa e vermelho', 0, null),
  ('polo-seven', 'polos-grupo', 'Grupo a vestir polos God Seven Line rosa e preto', 1, null),
  ('seven-signature', 'signature-preto', 'Polo Seven Signature preto vestido', 0, null),
  ('seven-signature', 'polos-grupo', 'Polo Seven Signature preto ao lado de polos rosa', 1, null),
  ('seven-street-tee', 'street-tee-ktm', 'Seven Street Tee preta com estampa nas costas', 0, null),
  ('a-tua-estampa', 'personalizado-tee-sacola', 'T-shirt branca e sacola personalizadas com capas de álbuns', 0, null),
  ('sacola-personalizada', 'sacola-rua', 'Sacola personalizada com a frase I am lost and I like it', 0, null),
  ('sacola-personalizada', 'personalizado-tee-sacola', 'Sacola personalizada com capas de álbuns', 1, null)
) as v (slug, image_url, alt_text, position, color)
join public.products p on p.slug = v.slug;

-- Variantes: apaga as destes produtos e insere as de data/products.json (stock/preço null = por definir).
delete from public.product_variants where product_id in (select id from public.products where slug in (
  't-shirt-seven',
  'polo-seven',
  'seven-signature',
  'seven-street-tee',
  'a-tua-estampa',
  'sacola-personalizada'
));

insert into public.product_variants (product_id, color, size, stock, price_override, sku, position)
select p.id, v.color, v.size::text, v.stock::integer, v.price_override::integer, v.sku::text, v.position::integer
from (values
  ('t-shirt-seven', 'Verde', 'S', null, null, null, 0),
  ('t-shirt-seven', 'Verde', 'M', null, null, null, 1),
  ('t-shirt-seven', 'Verde', 'L', null, null, null, 2),
  ('t-shirt-seven', 'Verde', 'XL', null, null, null, 3),
  ('t-shirt-seven', 'Verde', 'XXL', null, null, null, 4),
  ('polo-seven', 'Rosa', 'S', null, null, null, 0),
  ('polo-seven', 'Rosa', 'M', null, null, null, 1),
  ('polo-seven', 'Rosa', 'L', null, null, null, 2),
  ('polo-seven', 'Rosa', 'XL', null, null, null, 3),
  ('polo-seven', 'Rosa', 'XXL', null, null, null, 4),
  ('polo-seven', 'Vermelho', 'S', null, null, null, 5),
  ('polo-seven', 'Vermelho', 'M', null, null, null, 6),
  ('polo-seven', 'Vermelho', 'L', null, null, null, 7),
  ('polo-seven', 'Vermelho', 'XL', null, null, null, 8),
  ('polo-seven', 'Vermelho', 'XXL', null, null, null, 9),
  ('seven-signature', 'Preto', 'S', null, null, null, 0),
  ('seven-signature', 'Preto', 'M', null, null, null, 1),
  ('seven-signature', 'Preto', 'L', null, null, null, 2),
  ('seven-signature', 'Preto', 'XL', null, null, null, 3),
  ('seven-signature', 'Preto', 'XXL', null, null, null, 4),
  ('seven-street-tee', 'Preto', 'S', null, null, null, 0),
  ('seven-street-tee', 'Preto', 'M', null, null, null, 1),
  ('seven-street-tee', 'Preto', 'L', null, null, null, 2),
  ('seven-street-tee', 'Preto', 'XL', null, null, null, 3),
  ('seven-street-tee', 'Preto', 'XXL', null, null, null, 4),
  ('sacola-personalizada', 'Natural', null, null, null, null, 0)
) as v (slug, color, size, stock, price_override, sku, position)
join public.products p on p.slug = v.slug;

commit;

-- Resumo (aparece como resultado no SQL Editor).
select p.slug, p.status, p.base_price,
       (select count(*) from public.product_images i where i.product_id = p.id) as imagens,
       (select count(*) from public.product_variants v where v.product_id = p.id) as variantes
from public.products p
where p.slug in (
  't-shirt-seven',
  'polo-seven',
  'seven-signature',
  'seven-street-tee',
  'a-tua-estampa',
  'sacola-personalizada'
)
order by p.slug;
