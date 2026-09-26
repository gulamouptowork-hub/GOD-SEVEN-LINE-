# God Seven Line — website

Marca + coleção + pedido + gestão de stock, com finalização pelo WhatsApp.
Site estático gerado por Node (sem framework, sem dependências de runtime), publicado na Vercel.
Também é uma aplicação instalável (PWA): Android, iPhone e computadores podem adicioná-la ao ecrã
principal, e as páginas visitadas continuam disponíveis quando a ligação falha.

```
HOME → COLEÇÃO → PRODUTO → COR / TAMANHO / QUANTIDADE → ADICIONAR AO PEDIDO
     → O TEU PEDIDO → DADOS → RESUMO → WHATSAPP
```

## Comandos

Precisa do Node.js 22 ou mais recente (ver `engines` em `package.json`).

| Comando | O que faz |
|---|---|
| `npm run dev` | Gera `dist/` e serve em http://localhost:4173 |
| `npm run dev:demo` | Igual, com **preços e stock fictícios** (`tests/fixtures/products.demo.json`) para testar o fluxo completo. Nunca publicar. |
| `npm run build` | Gera `dist/` (é o que a Vercel corre — ver `vercel.json`) |
| `npm test` | Testes unitários, de build e do SQL do Supabase (`node:test`). O teste SQL corre num Postgres real em WASM se instalares `npm i --no-save @electric-sql/pglite`; sem ele é saltado. |
| `npm run check` | Sintaxe JS, links internos, SEO e regras de preço em `dist/` |
| `npm run images` | Regenera `assets/images/` a partir de `assets/originals/` (precisa de `npm i --no-save sharp`) |
| `npm run seed:sql` | Regenera `supabase/seed.sql` a partir de `data/products.json` |

## Onde mudar o quê

* **Número de WhatsApp, contactos, categorias, tamanhos, limites de stock, opções de entrega:** `config/site.js`
  (o WhatsApp também pode vir da variável de ambiente `WHATSAPP_NUMBER`).
* **Produtos, preços e stock (modo local):** `data/products.json` — `basePrice` e `variants[].stock`.
  Com Supabase configurado, tudo é gerido em `/admin`.
* **Supabase, variáveis de ambiente, admin e publicação:** [`docs/SETUP.md`](docs/SETUP.md)
* **Arquitetura e modelo de dados:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

> Os preços e o stock reais ainda não foram fornecidos: as peças mostram "Preço sob consulta" e um botão
> para perguntar no WhatsApp até serem configurados. Nenhum preço foi inventado.

## Instalar como aplicação

* **Android / Chrome:** abre o site e usa **Instalar aplicação** no rodapé ou no menu do navegador.
* **iPhone / Safari:** toca em **Partilhar → Adicionar ao ecrã principal**.
* **Computador / Chrome ou Edge:** usa o ícone de instalação na barra de endereço.

O `manifest.webmanifest` define nome, ícones e atalhos. O `service-worker.js` guarda apenas a loja
pública; `/admin` e `config/runtime.js` ficam sempre fora da cache offline.
