import { vi } from "vitest";
import { prisma } from "@/lib/db";
import { REVOLUT_BASE } from "@/lib/revolut";
import type { seedTwoGroups } from "./helpers";

/**
 * Bancos FALSOS (Mercury, Wise, Revolut) para os testes de sync. O `fetch` global é trocado por um
 * roteador que responde como a API de cada banco (formato tirado do que as rotas pedem e leem).
 * Nada sai da máquina: URL que o roteador não conhece responde 404 e fica em `unexpected`.
 */

export const MERCURY_API = "https://api.mercury.com/api/v1";
export const WISE_API = "https://api.wise.com";

type Json = Record<string, unknown>;

export interface MercuryFake { pages: Json[][]; cards: Json[]; failPage?: number }
export interface WiseFake {
  ownRecipientId: number;
  pages: Json[][];
  transfers: Record<string, Json>;
  quotes: Record<string, Json>;
  cardTransactions: Record<string, Json>;
  failPage?: number;
}
export interface RevolutFake { cards: Json[]; pages: Json[][]; failPage?: number }

export interface FakeBanks {
  mercury?: Record<string, MercuryFake>; // por id da conta no Mercury
  wise?: Record<string, WiseFake>; // por profileId
  revolut?: Record<string, RevolutFake>; // por access token (cada empresa tem o seu)
}

export type FakeCall = { url: string; auth: string };

const urlOf = (input: unknown) =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

export const wiseCursor = (page: number) => `wise-cursor-${page}`;

export function installFakeBanks(banks: FakeBanks) {
  const calls: FakeCall[] = [];
  const unexpected: string[] = [];

  function mercury(u: URL): Response | null {
    const cards = u.pathname.match(/^\/api\/v1\/account\/([^/]+)\/cards$/);
    if (cards) {
      const f = banks.mercury?.[decodeURIComponent(cards[1])];
      return f ? Response.json({ cards: f.cards }) : null;
    }
    if (u.pathname !== "/api/v1/transactions") return null;
    const f = banks.mercury?.[u.searchParams.get("accountId") ?? ""];
    if (!f) return null;
    const after = u.searchParams.get("start_after");
    let page = 0;
    if (after) {
      page = f.pages.findIndex((p) => p.length > 0 && p[p.length - 1].id === after) + 1;
      if (page === 0) return new Response(`unknown start_after ${after}`, { status: 400 });
    }
    if (f.failPage === page) return new Response("mercury boom", { status: 500 });
    return Response.json({ transactions: f.pages[page] ?? [] });
  }

  function wise(u: URL): Response | null {
    const p = u.pathname;
    if (p === "/v1/borderless-accounts") {
      const f = banks.wise?.[u.searchParams.get("profileId") ?? ""];
      return f ? Response.json([{ id: 1, profileId: Number(u.searchParams.get("profileId")) || 0, recipientId: f.ownRecipientId }]) : null;
    }
    let m = p.match(/^\/v1\/profiles\/([^/]+)\/activities$/);
    if (m) {
      const f = banks.wise?.[m[1]];
      if (!f) return null;
      const cur = u.searchParams.get("nextCursor");
      const page = cur ? Number(cur.replace("wise-cursor-", "")) : 0;
      if (f.failPage === page) return new Response("Service Unavailable", { status: 503 });
      const next = page + 1 < f.pages.length ? wiseCursor(page + 1) : null;
      return Response.json({ cursor: next, activities: f.pages[page] ?? [] });
    }
    m = p.match(/^\/v1\/transfers\/([^/]+)$/);
    if (m) {
      const t = Object.values(banks.wise ?? {}).map((f) => f.transfers[m![1]]).find(Boolean);
      return t ? Response.json(t) : Response.json({ error: "transfer not found" }, { status: 404 });
    }
    m = p.match(/^\/v3\/profiles\/([^/]+)\/quotes\/([^/]+)$/);
    if (m) {
      const q = banks.wise?.[m[1]]?.quotes[m[2]];
      return q ? Response.json(q) : Response.json({ error: "quote not found" }, { status: 404 });
    }
    m = p.match(/^\/v3\/profiles\/([^/]+)\/card-transactions\/([^/]+)$/);
    if (m) {
      const c = banks.wise?.[m[1]]?.cardTransactions[m[2]];
      return c ? Response.json(c) : Response.json({ error: "not found" }, { status: 404 });
    }
    return null;
  }

  function revolut(u: URL, auth: string): Response | null {
    const f = banks.revolut?.[auth.replace(/^Bearer /, "")];
    if (!f) return null;
    const path = u.toString().slice(REVOLUT_BASE.length).split("?")[0];
    if (path === "/cards") return Response.json(f.cards);
    if (path !== "/transactions") return null;
    const to = u.searchParams.get("to");
    let page = f.pages.findIndex((pg) => pg.length > 0 && pg[pg.length - 1].created_at === to) + 1; // 0 = 1ª página
    if (page >= f.pages.length) return Response.json([]);
    if (page < 0) page = 0;
    if (f.failPage === page) return new Response("boom", { status: 500 });
    return Response.json(f.pages[page]);
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const raw = urlOf(input);
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      calls.push({ url: raw, auth });
      const u = new URL(raw);
      let res: Response | null = null;
      if (raw.startsWith(MERCURY_API)) res = mercury(u);
      else if (raw.startsWith(WISE_API)) res = wise(u);
      else if (raw.startsWith(REVOLUT_BASE)) res = revolut(u, auth);
      if (!res) {
        unexpected.push(raw);
        return new Response("not found", { status: 404 });
      }
      return res;
    }),
  );

  return {
    calls,
    unexpected,
    /** Parâmetros de query das chamadas cuja URL começa com `prefix`. */
    queries(prefix: string) {
      return calls.filter((c) => c.url.startsWith(prefix)).map((c) => Object.fromEntries(new URL(c.url).searchParams));
    },
    reset() {
      calls.length = 0;
      unexpected.length = 0;
    },
  };
}

// ───────────────────────────── Mercury ─────────────────────────────

export const MERCURY_ACCT = "merc-ops-1";

const mtx = (id: string, extra: Json): Json => ({
  id,
  amount: -1,
  bankDescription: null,
  counterpartyName: "Vendor",
  merchantName: null,
  createdAt: "2026-10-01T10:00:00Z",
  postedAt: "2026-10-01T12:00:00Z",
  status: "sent",
  note: null,
  externalMemo: null,
  kind: "other",
  details: null,
  ...extra,
});

/** 2 páginas (500 + 3) — a 1ª cheia força o start_after. */
export function mercuryFixture(): MercuryFake {
  const specials = [
    mtx("m-meta-1", {
      merchantName: "FACEBK *A1B2C3D4E5", counterpartyName: "Facebook", bankDescription: "FACEBK *A1B2C3D4E5 MENLO PARK",
      amount: -123.45, createdAt: "2026-10-02T10:00:00Z", postedAt: "2026-10-03T14:00:00Z", kind: "debitCardTransaction",
      details: { debitCardInfo: { id: "card-uuid-meta" } },
    }),
    mtx("m-credit-1", {
      counterpartyName: "Meta Ads", amount: -80, createdAt: "2026-10-04T09:30:00Z", postedAt: null, kind: "creditCardTransaction",
      details: { creditCardInfo: { id: "card-uuid-credit" } },
    }),
    mtx("m-unknown-card", { counterpartyName: "Loja X", amount: -9.99, details: { debitCardInfo: { id: "card-not-listed" } } }),
    mtx("m-ireland", { counterpartyName: "Meta Platforms Ireland Limited", amount: -5000, kind: "outgoingPayment" }),
    mtx("m-bankdesc", { counterpartyName: "", bankDescription: "WIRE IN ACME CORP", amount: 2500, kind: "externalTransfer" }),
    mtx("m-empty", { counterpartyName: "", bankDescription: null, amount: -1.5 }),
    mtx("m-failed", { counterpartyName: "Falhou", status: "failed" }),
    mtx("m-cancelled", { counterpartyName: "Cancelada", status: "cancelled" }),
    mtx("m-pending", { counterpartyName: "Pendente", status: "pending", amount: -7 }),
    mtx("m-existing", { counterpartyName: "Já importada", amount: -42 }),
  ];
  const fillers = Array.from({ length: 500 - specials.length }, (_, i) =>
    mtx(`m-fill-${String(i).padStart(3, "0")}`, {
      counterpartyName: `Vendor ${i}`,
      amount: -(i + 1),
      postedAt: new Date(Date.UTC(2026, 9, 1) - i * 3_600_000).toISOString(),
    }),
  );
  const page2 = [
    mtx("m-p2-meta", { counterpartyName: "Facebk *zz99yy88xx", bankDescription: "FACEBK *ZZ99YY88XX", amount: -15 }),
    mtx("m-p2-a", { counterpartyName: "Aluguel", amount: -3000, postedAt: "2026-09-02T00:00:00Z" }),
    mtx("m-p2-b", { counterpartyName: "Stripe", amount: 999.99, postedAt: "2026-09-01T00:00:00Z" }),
  ];
  return {
    pages: [[...specials, ...fillers], page2],
    cards: [
      { cardId: "card-uuid-meta", lastFourDigits: "4242", nameOnCard: "Pixel", status: "active" },
      { cardId: "card-uuid-credit", lastFourDigits: "7777", nameOnCard: "Pixel", status: "active" },
      { cardId: "card-no-digits", nameOnCard: "Sem dígitos" },
    ],
  };
}

// ───────────────────────────── Wise ─────────────────────────────

export const WISE_PROFILE = "wise-prof-1";

const wact = (id: string, extra: Json): Json => ({
  id,
  type: "CARD_PAYMENT",
  resource: { type: "CARD_TRANSACTION", id: `res-${id}` },
  title: "Algo",
  description: "",
  primaryAmount: "1 USD",
  secondaryAmount: "",
  status: "COMPLETED",
  createdOn: "2026-10-01T00:00:00.000Z",
  ...extra,
});

/** 2 páginas por cursor; transferência de saída (com cotação), de entrada, sem detalhe, cartão, topup… */
export function wiseFixture(): WiseFake {
  const cardMeta = wact("act-card-meta", {
    resource: { type: "CARD_TRANSACTION", id: "ct-901" }, title: "<strong>Facebook</strong>", description: "Card ending in 1234",
    primaryAmount: "55.10 USD", createdOn: "2026-10-05T12:00:00.000Z",
  });
  return {
    ownRecipientId: 31337,
    pages: [
      [
        cardMeta,
        wact("act-transfer-out", {
          type: "TRANSFER", resource: { type: "TRANSFER", id: "70001" }, title: "<strong>Meta Platforms Ireland Limited</strong>",
          primaryAmount: "1,000 EUR", createdOn: "2026-10-06T08:00:00.000Z",
        }),
        wact("act-transfer-in", {
          type: "TRANSFER", resource: { type: "TRANSFER", id: "70002" }, title: "<strong>Google Ireland</strong>",
          primaryAmount: "<positive>+ 2,500.00 USD</positive>", createdOn: "2026-10-07T09:15:00.000Z",
        }),
        wact("act-pending", { status: "PENDING", primaryAmount: "10 USD" }),
      ],
      [
        wact("act-transfer-nodetail", {
          type: "TRANSFER", resource: { type: "TRANSFER", id: "70003" }, title: "Supplier",
          primaryAmount: "300 GBP", secondaryAmount: "352.40 USD", createdOn: "2026-09-20T16:00:00.000Z",
        }),
        wact("act-topup", { type: "TOPUP", resource: { type: "BALANCE_DEPOSIT", id: "d-1" }, title: "Topped up", primaryAmount: "€ 30", createdOn: "2026-09-18T07:00:00.000Z" }),
        wact("act-unparseable", { resource: { type: "CARD_TRANSACTION", id: "ct-902" }, title: "Estranha", primaryAmount: "valor indisponível" }),
        wact("act-existing", { resource: { type: "CARD_TRANSACTION", id: "ct-903" }, title: "Já importada", primaryAmount: "5 USD" }),
        cardMeta, // a mesma atividade repetida noutra página
      ],
    ],
    transfers: {
      "70001": { id: 70001, sourceAccount: 31337, sourceValue: 1000, sourceCurrency: "EUR", targetValue: 1080, targetCurrency: "USD", quoteUuid: "q-uuid-1", status: "outgoing_payment_sent" },
      "70002": { id: 70002, sourceAccount: 4242, sourceValue: 2500, sourceCurrency: "USD", targetValue: 2310.5, targetCurrency: "EUR", quoteUuid: "q-uuid-2", status: "outgoing_payment_sent" },
    },
    quotes: {
      "q-uuid-1": { payInMethod: "BALANCE", paymentOptions: [{ payIn: "BANK_TRANSFER", fee: { total: 9.99 } }, { payIn: "BALANCE", fee: { total: 4.12 } }] },
      "q-uuid-2": { payInMethod: "BALANCE", paymentOptions: [{ payIn: "BALANCE", fee: { total: 50 } }] },
    },
    cardTransactions: {
      "ct-901": { cardLastDigits: "1234", merchant: { name: "FACEBK *WQ12ER34TY" } },
      "ct-903": { cardLastDigits: "9999", merchant: { name: "FACEBK *NUNCAPEDIDA" } },
    },
  };
}

// ───────────────────────────── Revolut ─────────────────────────────

export const REVOLUT_TOKEN = "rev-access-pixel";

const rtx = (id: string, createdAt: string, extra: Json): Json => ({
  id,
  type: "card_payment",
  state: "completed",
  created_at: createdAt,
  updated_at: createdAt,
  legs: [{ leg_id: `leg-${id}`, account_id: "rev-acc-usd", amount: -1, currency: "USD" }],
  ...extra,
});

/** 2 páginas (1000 + 2) — a 1ª cheia força a janela `to` andar. */
export function revolutFixture(): RevolutFake {
  const at = (i: number) => new Date(Date.UTC(2026, 9, 10) - i * 60_000).toISOString();
  const specials: Array<(t: string) => Json> = [
    (t) => rtx("rtx-meta-1", t, {
      completed_at: "2026-10-10T03:00:00.000Z", merchant: { name: "Facebk *RVQ7K2M9P1" }, card: { card_number: "459678******9876" },
      legs: [{ leg_id: "leg-1", account_id: "rev-acc-eur", amount: -92.5, fee: 0.75, currency: "EUR", bill_amount: -100, bill_currency: "USD", description: "To Facebk *RVQ7K2M9P1" }],
    }),
    (t) => rtx("rtx-fx-1", t, {
      type: "exchange", reference: "Exchange EUR to USD",
      legs: [
        { leg_id: "leg-a", account_id: "rev-acc-eur", amount: -500, fee: 0, currency: "EUR", description: "Exchanged to USD" },
        { leg_id: "leg-b", account_id: "rev-acc-usd", amount: 540, currency: "USD", description: "Exchanged from EUR" },
      ],
    }),
    (t) => rtx("rtx-in-1", t, {
      type: "topup",
      legs: [{ leg_id: "leg-t", account_id: "rev-acc-usd", amount: 1000, fee: 2, currency: "USD", counterparty: { name: "ACME INC" }, description: "Payment from ACME" }],
    }),
    (t) => rtx("rtx-ref-1", t, { type: "transfer", reference: "Facebk *REFONLY777", legs: [{ leg_id: "leg-r", account_id: "rev-acc-usd", amount: -20, currency: "USD" }] }),
    (t) => rtx("rtx-bare", t, { type: "transfer", legs: [{ leg_id: "leg-x", account_id: "rev-acc-usd", amount: -1, currency: "USD" }] }),
    (t) => rtx("rtx-l4", t, { merchant: { name: "Some Shop" }, card: { last_digits: "5555" }, legs: [{ leg_id: "leg-l", account_id: "rev-acc-usd", amount: -12, currency: "USD", bill_amount: -12, bill_currency: "USD" }] }),
    (t) => rtx("rtx-unknown-card", t, { merchant: { name: "Other Shop" }, card: { card_number: "411111******3333" }, legs: [{ leg_id: "leg-u", account_id: "rev-acc-usd", amount: -3, currency: "USD" }] }),
    (t) => rtx("rtx-pending", t, { state: "pending", merchant: { name: "Facebk *PENDENTE01" } }),
    (t) => rtx("rtx-declined", t, { state: "declined", merchant: { name: "Recusada" } }),
    (t) => rtx("rtx-existing", t, {
      merchant: { name: "Facebk *EXISTENTE9" }, card: { card_number: "459678******9876" },
      legs: [{ leg_id: "leg-e", account_id: "rev-acc-eur", amount: -40, currency: "EUR", bill_amount: -45.5, bill_currency: "USD" }],
    }),
    (t) => rtx("rtx-upper", t, { state: "COMPLETED", merchant: { name: "Maiúsculo" }, legs: [{ leg_id: "leg-up", account_id: "rev-acc-usd", amount: -4, currency: "USD" }] }),
  ];
  const page1 = Array.from({ length: 1000 }, (_, i) =>
    i < specials.length
      ? specials[i](at(i))
      : rtx(`rtx-fill-${String(i).padStart(4, "0")}`, at(i), {
          merchant: { name: `Shop ${i}` },
          legs: [{ leg_id: `leg-f${i}`, account_id: "rev-acc-usd", amount: -(i / 100), currency: "USD" }],
        }),
  );
  const page2 = [
    rtx("rtx-p2-meta", at(1000), {
      merchant: { name: "FACEBK *P2REVOLUT9" }, card: { last_digits: "9876" },
      legs: [{ leg_id: "leg-p2", account_id: "rev-acc-usd", amount: -10, fee: 0.1, currency: "USD", bill_amount: -10, bill_currency: "USD" }],
    }),
    rtx("rtx-p2-b", at(1001), { merchant: { name: "Última" }, legs: [{ leg_id: "leg-p2b", account_id: "rev-acc-usd", amount: -2, currency: "USD" }] }),
  ];
  return {
    pages: [page1, page2],
    cards: [
      { id: "c1", last_digits: "9876", label: "BM 14 Snapnork", state: "ACTIVE" },
      { id: "c2", last_digits: "9876", label: "BM 15 Outro", state: "ACTIVE" },
      { id: "c3", last_digits: "5555", name: "Cartão Antigo", state: "ACTIVE" },
      { id: "c4", last_digits: "0000", state: "ACTIVE" },
      { id: "c5", label: "Sem dígitos", state: "ACTIVE" },
    ],
  };
}

// ───────────────────────────── banco de dados ─────────────────────────────

type Seed = Awaited<ReturnType<typeof seedTwoGroups>>;

/**
 * Contas da Pixel ligadas aos bancos falsos:
 *  - Mercury = a conta da Pixel do seed (operação Pixel), token próprio;
 *  - Wise = conta nova da Pixel (operação Pixel), token próprio;
 *  - Revolut = conta nova da Pixel SEM operação; credencial OAuth da empresa com access token válido.
 */
export async function seedBankAccounts(s: Seed) {
  const mercury = await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "tok-merc-pixel" } });
  const wise = await prisma.account.create({
    data: { companyId: s.companies.pixel.id, bank: "Wise", currency: "USD", name: "Wise Pixel", operationId: s.operations.pixel.id, apiToken: "tok-wise-pixel" },
  });
  const revolut = await prisma.account.create({
    data: { companyId: s.companies.pixel.id, bank: "Revolut", currency: "EUR", name: "Revolut Pixel" },
  });
  await prisma.credential.create({
    data: {
      issuer: "revolut",
      company: s.companies.pixel.name,
      token: "refresh-pixel",
      secrets: JSON.stringify({ clientId: "cli-pixel", redirectUri: "https://app.teste/api/revolut/callback", accessToken: REVOLUT_TOKEN, accessExp: Math.floor(Date.now() / 1000) + 3600 }),
    },
  });
  return { mercury, wise, revolut };
}

/** Linhas que já estavam no banco antes do sync (uma por banco, com ref que o banco falso devolve de novo). */
export async function seedExistingBankRows(a: { mercury: string; wise: string; revolut: string }) {
  await prisma.transaction.create({ data: { accountId: a.mercury, date: new Date("2026-10-01T12:00:00Z"), description: "Já importada", amount: -42, currency: "USD", reference: "m-existing" } });
  await prisma.transaction.create({ data: { accountId: a.wise, date: new Date("2026-10-01T00:00:00Z"), description: "Já importada", amount: -5, currency: "USD", reference: "wise-activity:act-existing" } });
  await prisma.transaction.create({
    data: { accountId: a.revolut, date: new Date("2026-10-01T00:00:00Z"), description: "Antigo", amount: -40, currency: "EUR", reference: "revolut:rtx-existing:leg-e", cardLast4: "9876" },
  });
}

/** O que o sync gravou, por conta, sem id/datas de gravação — ordenado pela referência. */
export async function rowsOf(accountId: string) {
  const rows = await prisma.transaction.findMany({ where: { accountId }, orderBy: { reference: "asc" } });
  return rows.map((r) => ({
    reference: r.reference,
    date: r.date.toISOString(),
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    fee: r.fee,
    isMetaCharge: r.isMetaCharge,
    metaRef: r.metaRef,
    cardLast4: r.cardLast4,
    cardLabel: r.cardLabel,
    operationId: r.operationId,
    billAmount: r.billAmount,
    billCurrency: r.billCurrency,
  }));
}

export async function rowByRef(accountId: string, reference: string) {
  return (await rowsOf(accountId)).find((r) => r.reference === reference);
}
