# Guia de configuração — God Seven Line

Este guia explica, passo a passo, como correr o site no computador, ligar a base de dados (Supabase),
publicar na Vercel e gerir o catálogo. Detalhes técnicos (modelo de dados, regras de segurança): `docs/ARCHITECTURE.md`.

O site funciona em dois modos:

| Modo | Quando | Catálogo | Pedidos |
|---|---|---|---|
| **Local** | Sem `SUPABASE_URL` / `SUPABASE_ANON_KEY` | `data/products.json` | Número temporário `GSL-AAMMDD-XXXX`, guardado só no telemóvel/computador do cliente |
| **Supabase** | Com as duas variáveis definidas no build | Base de dados, gerida no `/admin` | Número sequencial `GSL-0001`, `GSL-0002`… guardado na base de dados |

Em ambos os modos o pedido termina no WhatsApp da loja.

---

## 1. Correr o site no computador

Precisas do [Node.js](https://nodejs.org) 22 ou mais recente (o projeto foi testado com o Node 24).

```bash
npm run build      # gera o site em dist/
npm run dev        # build + servidor local → http://localhost:4173
npm test           # corre os testes automáticos
```

O servidor local só responde neste computador. Para abrir o site no telemóvel (na mesma rede Wi-Fi), usa
`HOST=0.0.0.0 npm run serve` (PowerShell: `$env:HOST = "0.0.0.0"; npm run serve`) e abre
`http://<IP-do-computador>:4173`.

### Modo demonstração (preços FICTÍCIOS)

```bash
npm run dev:demo
```

Usa `tests/fixtures/products.demo.json`, que tem **preços e stock inventados** só para testar o fluxo
completo (carrinho, checkout, mensagem WhatsApp).
**Nunca publiques este modo**: a Vercel corre sempre `npm run build`, que usa o catálogo real.

### Testar localmente com o Supabase

O build lê as variáveis do ambiente do terminal:

```powershell
# PowerShell (Windows)
$env:SUPABASE_URL = "https://o-teu-projeto.supabase.co"
$env:SUPABASE_ANON_KEY = "a-tua-anon-key"
npm run dev
```

```bash
# Git Bash / macOS / Linux
export SUPABASE_URL="https://o-teu-projeto.supabase.co"
export SUPABASE_ANON_KEY="a-tua-anon-key"
npm run dev
```

Alternativa: copia `.env.example` para `.env` (o `.env` nunca vai para o git), preenche e corre
`node --env-file=.env scripts/build.js` e depois `npm run serve`.

---

## 2. Definir preços e stock no modo local

No modo local o catálogo vive em `data/products.json`. Neste momento **todos os preços e stocks estão
vazios (`null`)** porque ainda não foram indicados — o site mostra "Preço sob consulta" e as peças
não podem ser adicionadas ao pedido (o cliente pode perguntar pelo WhatsApp).

Campos de cada produto:

| Campo | Significado |
|---|---|
| `basePrice` | Preço em meticais, **número inteiro sem pontos** (ex.: `1250` = 1.250 MT). `null` = "Preço sob consulta". |
| `status` | `active` (visível), `draft` (rascunho, escondido) ou `archived` (arquivado, escondido). |
| `featured` | `true` = aparece no NEW DROP da página inicial. |
| `orderMode` | `cart` = pedido normal com carrinho; `custom` = personalização, tratada pelo WhatsApp (sem carrinho). |
| `tag` | Etiqueta editorial opcional (ex.: `"SIGNATURE"`). |
| `createdAt` | Data de lançamento (ex.: `"2026-09-25"`). Produtos com menos de 30 dias mostram a etiqueta NOVO. `null` = sem etiqueta NOVO. |
| `images[].src` | Chave de uma imagem de `assets/images` (ex.: `"tee-verde-modelo"`) ou URL completo. |
| `images[].alt` | Descrição da imagem (acessibilidade e Google). |

Campos de cada variante (`variants[]` — uma linha por cor × tamanho):

| Campo | Significado |
|---|---|
| `color` | Cor (ex.: `"Verde"`). |
| `size` | Tamanho (`XS`, `S`, `M`, `L`, `XL`, `XXL`) ou `null` para tamanho único. |
| `stock` | Unidades disponíveis, inteiro ≥ 0. `0` = esgotado; 1 a 3 = "Últimas N unidades"; `null` = por definir (a variante não se vende). |
| `priceOverride` | Preço só desta variante (ex.: XXL mais caro). `null` = usa o `basePrice`. |
| `sku` | Código interno opcional. |

Uma variante só pode ser encomendada quando tem **preço** (`priceOverride` ou `basePrice`) **e stock**
definidos. Exemplo:

```json
"basePrice": 1250,
"variants": [
  { "id": "t-shirt-seven-verde-m", "color": "Verde", "size": "M", "stock": 8, "priceOverride": null, "sku": null },
  { "id": "t-shirt-seven-verde-xxl", "color": "Verde", "size": "XXL", "stock": 2, "priceOverride": 1400, "sku": null }
]
```

*(Valores de exemplo — não são os preços reais da loja.)*

Depois de editar:

1. `npm test` — valida o catálogo. Quando puseres os preços reais, o teste "o catálogo real não inventa
   preços nem stock" (`tests/catalog.test.js`) deixa de fazer sentido e deve ser removido.
2. `npm run seed:sql` — atualiza `supabase/seed.sql` (o teste `tests/seed.test.js` avisa se te esqueceres).
3. Faz commit e push: a Vercel publica automaticamente.

> Com o Supabase ligado, `data/products.json` deixa de ser a fonte do catálogo: preços e stock passam a
> ser geridos no `/admin` (secção 6).

---

## 3. Configurar o Supabase

### 3.1 Criar o projeto

1. Cria uma conta em [supabase.com](https://supabase.com) e um projeto novo (escolhe a região disponível mais próxima).
2. Guarda a palavra-passe da base de dados num local seguro. Ela **não** é usada no site.

### 3.2 Criar as tabelas e as regras de segurança

1. No painel do projeto: **SQL Editor → New query**.
2. Cola todo o conteúdo de `supabase/schema.sql` e carrega em **Run**.
   O Supabase pode avisar que o script tem operações destrutivas (`drop policy` / `drop trigger`):
   é esperado — só recria regras de acesso, não apaga dados. Confirma.
3. Deve aparecer: *"Esquema God Seven Line instalado."*

O script cria as tabelas (`products`, `product_images`, `product_variants`, `orders`, `order_items`,
`admin_users`), as regras de acesso (RLS), a função `create_order` que regista os pedidos e o bucket
de imagens `product-images`. Pode ser corrido de novo sem perder dados.

O bucket `product-images` é público **por URL**: cada fotografia abre-se pelo seu endereço (é assim que
a loja a mostra), mas o conteúdo do bucket **não pode ser listado** por quem tem a anon key — só os
administradores listam, carregam e apagam ficheiros. Assim, as fotografias de peças ainda em rascunho
não ficam expostas, desde que o seu endereço não seja partilhado.

### 3.3 Carregar o catálogo inicial

1. **SQL Editor → New query**, cola `supabase/seed.sql` e carrega em **Run**.
2. O resultado lista os 6 produtos com o número de imagens e variantes.

> **Atenção:** corre o seed **apenas uma vez**, no início. Voltar a corrê-lo repõe os dados de
> `data/products.json` nesses produtos e **apaga e recria as imagens e variantes** — o stock e os
> preços definidos no `/admin` perdem-se.

### 3.4 Chaves do projeto

- **Project URL** → vai para `SUPABASE_URL` (ex.: `https://abcdefghijkl.supabase.co`).
  Está em **Project Settings → Data API** (ou no botão **Connect** no topo do projeto).
- **Chave pública** → vai para `SUPABASE_ANON_KEY`. Serve qualquer uma das duas:
  - a nova **publishable key** (`sb_publishable_…`), em **Project Settings → API Keys**;
  - ou a antiga **anon public** (começa por `eyJ`), em **Project Settings → API Keys → Legacy API keys**.

A anon key é pública por natureza (vai para o browser); a segurança vem das regras RLS do `schema.sql`.

> **Nunca uses a `service_role` key (nem a `secret` key) no site, na Vercel ou no git.** Ela ignora
> todas as regras de segurança. O build recusa-se a continuar se a detetar em `SUPABASE_ANON_KEY`.

### 3.5 Fechar os registos públicos

Qualquer pessoa com a anon key poderia criar uma conta (sem acesso ao admin, mas é lixo desnecessário).
Em **Authentication → Sign In / Providers**, desliga **Allow new users to sign up**.

### 3.6 Criar o utilizador administrador

1. **Authentication → Users → Add user → Create new user**.
2. Indica o email e uma palavra-passe forte e marca **Auto Confirm User**. Carrega em **Create user**.
3. Regista-o como administrador: **SQL Editor → New query** (substitui `EMAIL` pelo email do passo 2):

```sql
insert into public.admin_users (user_id, email)
select id, email from auth.users where email = 'EMAIL'
on conflict (user_id) do nothing;
```

Para retirar o acesso a alguém:

```sql
delete from public.admin_users where email = 'EMAIL';
```

Só quem está em `admin_users` consegue ver pedidos e alterar produtos, mesmo que tenha conta.

### 3.7 Ativar as estatísticas de visitantes

1. **SQL Editor → New query**, cola todo o conteúdo de `supabase/analytics.sql` (sempre depois do
   `schema.sql`) e carrega em **Run**. Pode ser corrido de novo sem perder dados.
2. A página **Visitantes** do `/admin` passa a contar as visitas a partir desse momento.

Guarda só dados anónimos: identificador aleatório do browser e da visita, página, produto, domínio de
origem e tipo de dispositivo — sem nomes, telefones nem IP. Quem tem "Não rastrear" (Do Not Track) ou
Global Privacy Control ativo não é contado. Enquanto este passo não for feito, a loja funciona
normalmente e deixa de tentar enviar estatísticas logo na primeira página da visita.

Limites contra abusos (em `track_events`): 120 eventos por visitante em 10 minutos e, no total da loja,
1.000 eventos por minuto e 30.000 em 24 horas. Acima disso os eventos são ignorados (a loja não é afetada).
Os dados não expiram sozinhos; para apagar eventos antigos, corre de vez em quando no SQL Editor:
`delete from public.analytics_events where created_at < now() - interval '13 months';`

---

## 4. Publicar na Vercel

O `vercel.json` já define o comando de build (`npm run build`) e a pasta publicada (`dist`).

1. Importa o repositório na Vercel (**Add New → Project**).
2. Em **Project Settings → Environment Variables**, adiciona (para *Production* e *Preview*):
   - `SUPABASE_URL` — o Project URL.
   - `SUPABASE_ANON_KEY` — a anon public key.
   - `WHATSAPP_NUMBER` — *opcional*, ver secção 5.
   (Também funcionam os nomes que o Supabase sugere para Next.js: `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.)
3. As variáveis só são lidas durante o build: depois de as alterares faz **Deployments → ⋯ → Redeploy**.

No fim do build, o log indica o modo: `Modo: Supabase` ou `Modo: local (sem backend)`.

Com o Supabase configurado, o build lê o catálogo da base de dados. Se não conseguir (URL ou chave errados,
`schema.sql` por correr, Supabase em baixo ou sem resposta em 15 segundos), **o build falha** com a mensagem
`✗ Não foi possível ler o Supabase no build (…)`. Assim a Vercel não publica páginas feitas com dados errados
e o **último deploy bom continua no ar**. Corrige a causa e faz Redeploy.

Só para testes, `ALLOW_LOCAL_FALLBACK=1` faz o build continuar mesmo assim, com as páginas estáticas feitas a
partir de `data/products.json`. O log diz então
`Modo: Supabase (páginas estáticas de data/products.json — Supabase inacessível no build)`.
Não definas esta variável na Vercel.

---

## 5. Número do WhatsApp

Os pedidos e os botões WhatsApp usam o número **+258 87 020 4282** (já usado no site original).

- **Mudar de forma permanente:** em `config/site.js`, altera `whatsappNumber` (só dígitos, com indicativo,
  ex.: `258XXXXXXXXX`) e `contact.phoneDisplay` (o número como aparece escrito no site).
- **Mudar sem mexer no código:** define `WHATSAPP_NUMBER` na Vercel e faz Redeploy. Isto muda o número
  para onde vão os pedidos e os links WhatsApp; o número escrito (`phoneDisplay`) continua o de `config/site.js`.

> Algumas fotografias originais mostram outro número (**84 060 8723**) e a conta `@god_7line`. As imagens
> publicadas são recortadas sem essa faixa (`scripts/optimize-images.js`), e o site mantém o número já
> configurado (+258 87 020 4282) até o dono confirmar qual é o correto.

---

## 6. Painel `/admin`

Disponível em `https://<o-teu-site>/admin` quando o Supabase está configurado. Não aparece no Google.

- **Entrar:** email e palavra-passe do administrador criado no passo 3.6. Contas que não estão em
  `admin_users` não conseguem ver nem alterar nada.
- **Produtos:** criar e editar peças (nome, slug, categoria, descrição, preço base, estado, destaque,
  modo de pedido, etiqueta), imagens (carregadas para o bucket `product-images`, até 5 MB, JPG/PNG/WebP)
  e variantes (cor, tamanho, stock, preço próprio, SKU). Um produto só aparece na loja com estado **Ativo**.
- **Stock:** atualizar as unidades disponíveis de cada cor/tamanho.
- **Visitantes:** visitas de hoje (por hora), dos últimos 30 dias, 12 semanas e 12 meses, com comparação
  com o período anterior, produtos mais vistos, funil de compra, origem, dispositivos e horas de maior
  movimento (precisa do passo 3.7). Ao entrar no painel, as visitas desse browser deixam de contar
  (opção "Não contar as visitas deste browser", no fim da página).
- **Pedidos:** lista com número `GSL-…`, cliente, peças, totais e estado
  (Novo → Confirmado → Em preparação → Concluído, ou Cancelado), e contacto do cliente pelo WhatsApp.

Como funciona um pedido: no checkout o site chama a função `create_order`, que **volta a verificar no
servidor** o preço, o stock e se a peça está ativa (preços enviados pelo browser são ignorados). Se algo
mudou entretanto, o cliente é avisado antes de abrir o WhatsApp. O stock **não é descontado
automaticamente**: quando confirmares um pedido, ajusta o stock no admin.

### Páginas dos produtos e SEO: o que muda logo e o que precisa de Redeploy

As páginas são HTML gerado no build (com o catálogo lido do Supabase nesse momento). No browser, o JavaScript
volta **sempre** a ler a base de dados, por isso para quem visita a loja as alterações do `/admin` valem logo:

| Muda **logo** (sem deploy) | Só muda no **próximo deploy** |
|---|---|
| Preço, stock, imagens, tamanhos e estado mostrados na página, no catálogo e no NEW DROP (depois de a página carregar) | O HTML estático que o Google e as pré-visualizações do WhatsApp/Facebook leem (não correm JavaScript) |
| O que se pode pôr no pedido e a validação no checkout (`create_order` verifica preço e stock no servidor) | Título, descrição e imagem de partilha (`og:*`) de cada página — ex.: a descrição continua a dizer "Preço sob consulta" depois de pores um preço |
| Produto novo: abre em `/produtos/<slug>` pela página genérica `/produto` (montada no browser, `noindex`, título genérico nas pré-visualizações) | Dados estruturados do Google (preço e disponibilidade no JSON-LD) e `product:price` |
| Produto passado a rascunho/arquivado: a página mostra "Peça não encontrada" | `sitemap.xml` e a lista de páginas `/produtos/<slug>` pré-geradas (uma peça retirada continua no sitemap) |

Por isso, depois de mudares preços, stock, imagens, estados ou de criares peças, faz **Deployments → ⋯ →
Redeploy** na Vercel (1–2 minutos). Se o build falhar (secção 4), o site anterior continua publicado.

#### Automatizar o Redeploy (recomendado)

Para não depender de te lembrares, liga um **Deploy Hook** da Vercel a um **Database Webhook** do Supabase.
Cada alteração a produtos, imagens ou variantes passa a publicar o site sozinha.

1. **Vercel → Project → Settings → Git → Deploy Hooks**: nome `supabase-produtos`, branch `main` →
   **Create Hook**. Copia o URL (`https://api.vercel.com/v1/integrations/deploy/…`).
   Trata-o como uma palavra-passe: quem o tiver pode lançar deploys. **Não** o ponhas no código, no git
   nem nas variáveis da Vercel.
2. **Supabase → Database → Webhooks → Create a new hook** (se pedir, ativa primeiro os webhooks):
   - Name: `redeploy-loja`
   - Table: `products`; Events: **Insert**, **Update** e **Delete**
   - Type: **HTTP Request**, Method **POST**, URL: o Deploy Hook do passo 1 (sem headers nem parâmetros)
   - **Create webhook**.
3. Repete o passo 2 para as tabelas `product_variants` e `product_images` (mesmo URL).
4. Testa: muda o stock de uma variante no `/admin` e confirma que aparece um deploy novo em
   **Vercel → Deployments**.

Notas: cada gravação no admin pode lançar vários deploys seguidos (produto, imagens e variantes); a Vercel
publica-os por ordem e o último fica no ar. Os webhooks não se aplicam a `orders`, por isso os pedidos
nunca lançam deploys.

---

## 7. Imagens

As fotografias usadas pelo site (chaves como `tee-verde-modelo`) são WebP otimizados em `assets/images`,
gerados a partir dos originais:

1. Coloca a fotografia original em `assets/originals/`.
2. Regista-a na lista `IMAGES` de `scripts/optimize-images.js`, com uma chave nova, o nome do ficheiro e as
   larguras (ex.: `{ key: 'hoodie-preto', file: 'foto.jpg', widths: [480, 800, 1080] }`; `crop` é opcional).
3. Corre:

   ```bash
   npm i --no-save sharp && npm run images
   ```

   Para refazer só algumas imagens (as outras, os ícones e o manifest ficam como estão):
   `npm run images -- tee-verde-costas tee-verde-detalhe`.

4. Usa a chave em `data/products.json` (`images[].src`) ou no admin, e faz commit de `assets/images/` e
   `js/lib/image-manifest.js`.

No admin também podes simplesmente carregar uma fotografia: fica no Supabase Storage e é usada pelo URL
(quem tiver o endereço vê a imagem, mas ninguém fora do admin consegue listar as fotografias guardadas).

---

## 8. Decisões de negócio pendentes

Nada disto foi inventado no site — está à espera de confirmação do dono:

- [ ] **Preços reais** de cada peça (hoje: "Preço sob consulta").
- [ ] **Stock** por cor e tamanho (hoje: por definir, por isso nada se pode encomendar pelo carrinho).
- [ ] **Tamanhos disponíveis** por produto (hoje: S a XXL em todas as peças de roupa, por confirmar).
- [ ] **Taxas de entrega**: não há nenhuma configurada. A entrega é combinada pelo WhatsApp e o total não a inclui.
- [ ] **Desconto automático de stock** quando um pedido é confirmado (hoje é manual, no admin).
- [ ] **Número de WhatsApp** definitivo (secção 5).

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Os produtos mostram "Preço sob consulta" e não se adicionam ao pedido | Falta preço ou stock na variante. |
| Um produto não aparece na loja | Estado diferente de **Ativo**. |
| O checkout diz que uma peça já não está disponível | O produto deixou de estar ativo, passou a personalização, ou perdeu preço/stock. |
| No admin: "Sem permissão" ou lista de pedidos vazia | O utilizador não está em `admin_users` (passo 3.6). |
| O log da Vercel diz `Modo: local` | Faltam `SUPABASE_URL`/`SUPABASE_ANON_KEY` ou não foi feito Redeploy depois de as definir. |
| O build falha com `Não foi possível ler o Supabase no build` | URL ou chave errados (`HTTP 401`), `schema.sql` por correr (`HTTP 404`) ou Supabase sem resposta. O site anterior continua publicado; corrige e faz Redeploy (secção 4). |
| Uma partilha no WhatsApp ou o Google mostram preço/stock antigos | Falta um Redeploy depois da alteração no admin (secção 6). |
| Carregar imagem falha com "bucket not found" | O `schema.sql` não foi corrido até ao fim. |
