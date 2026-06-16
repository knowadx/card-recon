# Card Recon — Conciliação Gasto (Meta Ads) × Cobrança (Cartões)

Ferramenta de **controle antifraude**: cruza o **gasto** das Contas de Anúncio do Meta
(por BM/Conta) com as **cobranças reais** que caíram nos cartões de crédito
(Mercury / Wise / Revolut), e destaca divergências — o caso central é detectar
**cartão vazado/clonado**.

## Como funciona

- A **Meta Marketing API** dá: contas de anúncio, qual cartão financia cada conta
  (`funding_source_details`) e o **spend** por período. Ela **não** expõe eventos de
  cobrança no cartão.
- As **APIs dos bancos** dão as **cobranças reais** (valor que tocou o cartão) +
  o **registro dos seus cartões** (últimos 4 dígitos).
- A conciliação cruza os dois lados pela **chave = últimos 4 dígitos do cartão**,
  agregada por cartão/período.

### Modelo de alertas (registro de bancos = verdade)

| Status | Cor | Significado |
|---|---|---|
| `unregistered` | 🔴 | Conta Meta financiada por cartão **fora do seu registro de bancos** → vazamento/terceiro, ou banco ainda não integrado |
| `divergence` | 🟠 | Cartão casado, mas cobrado × spend diverge além da tolerância |
| `unmatched_charge` | ⚪ | Cobrança Meta num cartão SEU sem conta visível (Meta só expõe funding de parte das contas) — neutro |
| `no_charge` | ⚪ | Conta com spend mas sem cobrança vista (timing/limiar) |
| `ok` | 🟢 | Bate dentro da tolerância |

Cobranças Meta **sem cartão** (transferências/wires) aparecem numa seção própria.

## Stack

Next.js 16 (App Router, TS) · Tailwind · Prisma 7 + libSQL (SQLite local / Turso em prod).

## Rodando local

```bash
cp .env.example .env       # preencha os tokens
npm install
npx prisma migrate dev     # cria o dev.db
npm run dev                # http://localhost:3007
```

No dashboard: botões **Sync** (Meta / Mercury / Wise / Revolut / Tudo) + seletor de mês.

## Provedores e autenticação

| Provedor | Auth | Observações |
|---|---|---|
| **Meta** | Bearer token (`META_ACCESS_TOKEN`) | escopos `ads_read` + `business_management` (este p/ agrupar por BM) |
| **Mercury** | Bearer token, **1 por empresa** | token vem com prefixo `secret-token:`; cadastre em `/settings` |
| **Wise** | Bearer token | usa `/activities` + `/card-transactions` (sem SCA) |
| **Revolut** | OAuth client-assertion (JWT RS256), **por empresa** | sobe o `revolut_public.cer` em cada conta → Client ID próprio; consenta em `/settings` |

### Multi-empresa

Tabela `Credential` guarda 1 credencial por empresa por emissor. Sem credencial no DB,
cai no token único do `.env` (empresa “default”). Mercury/Wise: cadastre em `/settings`.
Revolut: registre via `/settings` (Empresa + Client ID → Consentir).

### Revolut — certificado X.509

A chave privada (`revolut_private.pem`, ou env `REVOLUT_PRIVATE_KEY`) é **compartilhada**;
o certificado público `revolut_public.cer` é subido em **cada** conta Revolut, que
devolve um Client ID por empresa. O redirect OAuth precisa ser **HTTPS** em produção.

## Telas

- `/` Dashboard — alertas, conciliação por cartão, spend por BM, wires.
- `/cards` — cartões registrados dos bancos.
- `/charges` — cobranças (filtro por banco / só-Meta).
- `/settings` — tolerância, regex Meta, credenciais por empresa, consentimento Revolut.

## Deploy (Vercel + Turso)

1. Crie um DB Turso → `DATABASE_URL` (`libsql://…`) + `DATABASE_AUTH_TOKEN`.
2. `npx prisma migrate deploy` contra o Turso.
3. Importe o repo na Vercel; configure as env vars (ver `.env.example`), incluindo
   `REVOLUT_PRIVATE_KEY` (conteúdo do PEM com `\n`) e `REVOLUT_REDIRECT_URI` HTTPS.
4. O adapter libSQL é selecionado automaticamente quando `DATABASE_URL` é `libsql://`.
