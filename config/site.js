// Configuração central da God Seven Line.
// Tudo o que é específico da marca/negócio vive aqui — não repetir estes valores noutros ficheiros.
// Credenciais (Supabase) NÃO entram aqui: ver config/runtime.js (gerado no build a partir de variáveis de ambiente).

export const SITE_CONFIG = Object.freeze({
  brandName: 'God Seven Line',
  siteUrl: 'https://god-seven-line.vercel.app',
  locale: 'pt-MZ',
  currency: 'MZN',
  currencyLabel: 'MT',

  // Número já usado no site original. Pode ser substituído pela variável de ambiente WHATSAPP_NUMBER.
  whatsappNumber: '258870204282',
  contact: Object.freeze({
    phoneDisplay: '+258 87 020 4282',
    // Ao mudar a morada, atualizar também addressTitle (título da página Localização; \n = mudança de linha)
    // e a indicação de levantamento em deliveryOptions.
    address: 'Vila da Manhiça, em frente ao Millennium BIM',
    addressTitle: 'Em frente ao\nMillennium BIM.',
    city: 'Vila da Manhiça, Moçambique',
    hours: Object.freeze([
      Object.freeze({ days: 'Segunda — Sexta', time: '08h00 — 17h00' }),
      Object.freeze({ days: 'Sábado', time: '08h00 — 17h00' }),
      Object.freeze({ days: 'Domingo', time: 'Encerrado' })
    ])
  }),
  social: Object.freeze({
    instagram: Object.freeze({ url: 'https://www.instagram.com/godsevenline_estampagem/', handle: '@godsevenline_estampagem' })
  }),

  // Stock
  lowStockThreshold: 3, // variante com stock <= 3 → "Últimas N unidades"
  productLowStockThreshold: 5, // produto com stock total <= 5 → etiqueta ÚLTIMAS UNIDADES
  newProductDays: 30, // produto criado há menos de N dias → etiqueta NOVO

  // image: fotografia do cartão "Shop by category" na homepage (categorias sem imagem não aparecem lá).
  categories: Object.freeze([
    Object.freeze({ id: 't-shirts', label: 'T-shirts', image: 'tee-verde-modelo' }),
    Object.freeze({ id: 'polos', label: 'Polos', image: 'polos-grupo' }),
    Object.freeze({ id: 'hoodies', label: 'Hoodies', image: null }),
    Object.freeze({ id: 'acessorios', label: 'Acessórios', image: 'sacola-rua' }),
    Object.freeze({ id: 'personalizacao', label: 'Personalização', image: 'personalizado-tee-sacola' })
  ]),
  sizes: Object.freeze(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
  // Amostras de cor para os botões de cor. Cores sem entrada usam um tom neutro.
  colorSwatches: Object.freeze({
    Preto: '#141414', Branco: '#f7f7f2', Verde: '#1c8f4e', Rosa: '#ef2b7c',
    Vermelho: '#d7262f', Natural: '#e7dcc4', Amarelo: '#f2c230', Cinzento: '#8d8f88'
  }),
  // Faixas usadas apenas pelo filtro do catálogo (não são preços).
  priceRanges: Object.freeze([
    Object.freeze({ id: 'ate-1000', label: 'Até 1.000 MT', min: 0, max: 1000 }),
    Object.freeze({ id: '1000-2000', label: '1.000 — 2.000 MT', min: 1000, max: 2000 }),
    Object.freeze({ id: 'mais-2000', label: 'Mais de 2.000 MT', min: 2000, max: null })
  ]),

  // Entrega: sem taxas configuradas. Quando existirem, definir deliveryFees ({ <id da opção>: valor em MT }):
  // resumo, mensagem e total passam a incluí-las (lidas só por deliveryFeeFor em js/lib/order.js).
  // A create_order (supabase/schema.sql) ainda não conhece taxas — valida só o subtotal das peças e grava
  // delivery_fee = null —, por isso o schema tem de ser atualizado para o pedido guardado incluir a taxa.
  deliveryOptions: Object.freeze([
    Object.freeze({ id: 'levantamento', label: 'Levantamento', hint: 'Levantar na loja — Vila da Manhiça', requiresLocation: false }),
    Object.freeze({ id: 'entrega', label: 'Entrega', hint: 'Receber no endereço — combinado pelo WhatsApp', requiresLocation: true })
  ]),
  deliveryFees: Object.freeze({}),

  orderStatuses: Object.freeze([
    Object.freeze({ id: 'novo', label: 'Novo' }),
    Object.freeze({ id: 'confirmado', label: 'Confirmado' }),
    Object.freeze({ id: 'em_preparacao', label: 'Em preparação' }),
    Object.freeze({ id: 'concluido', label: 'Concluído' }),
    Object.freeze({ id: 'cancelado', label: 'Cancelado' })
  ]),

  storageKeys: Object.freeze({
    cart: 'gsl-cart-v2',
    lastOrder: 'gsl-last-order-v1',
    checkout: 'gsl-checkout-v1'
  }),

  // Secção SEVEN COMMUNITY / VISTO NAS RUAS. Para adicionar fotografias novas basta acrescentar entradas
  // (chave de assets/images via npm run images, ou URL completo).
  community: Object.freeze([
    Object.freeze({ image: 'tee-verde-costas', alt: 'T-shirt verde God Seven Line com estampa nas costas' }),
    Object.freeze({ image: 'tee-preta-amarelo', alt: 'Visual preto e amarelo com t-shirt God Seven Line' }),
    Object.freeze({ image: 'tees-brancas-rua', alt: 'Dois jovens com t-shirts brancas God Seven Line' }),
    Object.freeze({ image: 'polos-grupo', alt: 'Grupo a vestir polos God Seven Line rosa e preto' }),
    Object.freeze({ image: 'street-tee-ktm', alt: 'T-shirt street edition vista de costas' })
  ])
});

export function categoryLabel(id) {
  return SITE_CONFIG.categories.find(category => category.id === id)?.label ?? id ?? '';
}

export function deliveryOption(id) {
  return SITE_CONFIG.deliveryOptions.find(option => option.id === id) ?? null;
}

export function orderStatusLabel(id) {
  return SITE_CONFIG.orderStatuses.find(status => status.id === id)?.label ?? id ?? '';
}
