import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { REVOLUT_BASE } from "@/lib/revolut";
import * as mercuryRoute from "@/app/api/sync/mercury/route";
import * as wiseRoute from "@/app/api/sync/wise/route";
import * as revolutRoute from "@/app/api/sync/revolut/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";
import {
  installFakeBanks,
  MERCURY_ACCT,
  MERCURY_API,
  mercuryFixture,
  REVOLUT_TOKEN,
  revolutFixture,
  rowByRef,
  rowsOf,
  seedBankAccounts,
  seedExistingBankRows,
  WISE_API,
  WISE_PROFILE,
  wiseCursor,
  wiseFixture,
} from "./bankFakes";

/**
 * CARACTERIZAÇÃO das rotas de sync por banco (o comportamento de HOJE, antes de extrair a lógica).
 * Banco 100% falso (tests/bankFakes.ts): nenhuma chamada sai da máquina.
 */

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let acc: Awaited<ReturnType<typeof seedBankAccounts>>;

beforeEach(async () => {
  resetRequest();
  await prisma.setting.deleteMany();
  s = await seedTwoGroups();
  acc = await seedBankAccounts(s);
  await seedExistingBankRows({ mercury: acc.mercury.id, wise: acc.wise.id, revolut: acc.revolut.id });
  loginAs(s.users.pixel); // membro do grupo, com credencial PRÓPRIA em cada conta
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const syncConfigOf = async (id: string) => (await prisma.account.findUnique({ where: { id } }))?.syncConfig ?? null;
const today = () => new Date().toISOString().slice(0, 10);

// ───────────────────────────── Mercury ─────────────────────────────

describe("POST /api/sync/mercury (caracterização)", () => {
  const post = (json: Record<string, unknown>) => mercuryRoute.POST(req("/api/sync/mercury", { method: "POST", json }));
  const FROM = "2026-09-01";
  const TO = "2026-10-12";

  it("pagina por start_after, grava as linhas marcadas, pula failed/cancelled/existentes e lembra a conta", async () => {
    const fake = installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    const res = await post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 500, skipped: 3, range: { start: FROM, end: TO } });

    // chamadas: 2 páginas de /transactions (limit 500, start/end, start_after = último id da 1ª) + cartões 1x
    expect(fake.queries(`${MERCURY_API}/transactions`)).toEqual([
      { accountId: MERCURY_ACCT, limit: "500", start: FROM, end: TO },
      { accountId: MERCURY_ACCT, limit: "500", start: FROM, end: TO, start_after: "m-fill-489" },
    ]);
    expect(fake.calls.filter((c) => c.url === `${MERCURY_API}/account/${MERCURY_ACCT}/cards`)).toHaveLength(1);
    expect(fake.calls).toHaveLength(3);
    expect(new Set(fake.calls.map((c) => c.auth))).toEqual(new Set(["Bearer tok-merc-pixel"]));
    expect(fake.unexpected).toEqual([]);

    const id = acc.mercury.id;
    const base = { fee: 0, currency: "USD", cardLabel: null, billAmount: null, billCurrency: null };
    // descrição: merchantName > counterpartyName > bankDescription > "—"; data: postedAt ?? createdAt
    expect(await rowByRef(id, "m-meta-1")).toEqual({
      ...base, reference: "m-meta-1", date: "2026-10-03T14:00:00.000Z", description: "FACEBK *A1B2C3D4E5", amount: -123.45,
      isMetaCharge: true, metaRef: "A1B2C3D4E5", cardLast4: "4242",
    });
    expect(await rowByRef(id, "m-credit-1")).toEqual({
      ...base, reference: "m-credit-1", date: "2026-10-04T09:30:00.000Z", description: "Meta Ads", amount: -80,
      isMetaCharge: true, metaRef: null, cardLast4: "7777",
    });
    expect(await rowByRef(id, "m-unknown-card")).toMatchObject({ cardLast4: null, isMetaCharge: false, metaRef: null, description: "Loja X" });
    expect(await rowByRef(id, "m-ireland")).toMatchObject({ isMetaCharge: false, metaRef: null, amount: -5000, description: "Meta Platforms Ireland Limited" });
    expect(await rowByRef(id, "m-bankdesc")).toMatchObject({ description: "WIRE IN ACME CORP", amount: 2500, isMetaCharge: false });
    expect(await rowByRef(id, "m-empty")).toMatchObject({ description: "—", amount: -1.5 });
    expect(await rowByRef(id, "m-pending")).toMatchObject({ description: "Pendente", amount: -7 }); // pending entra
    expect(await rowByRef(id, "m-p2-meta")).toEqual({
      ...base, reference: "m-p2-meta", date: "2026-10-01T12:00:00.000Z", description: "Facebk *zz99yy88xx", amount: -15,
      isMetaCharge: true, metaRef: "zz99yy88xx", cardLast4: null,
    });
    expect(await rowByRef(id, "m-fill-007")).toEqual({
      ...base, reference: "m-fill-007", date: new Date(Date.UTC(2026, 9, 1) - 7 * 3_600_000).toISOString(), description: "Vendor 7", amount: -8,
      isMetaCharge: false, metaRef: null, cardLast4: null,
    });
    expect(await rowByRef(id, "m-failed")).toBeUndefined();
    expect(await rowByRef(id, "m-cancelled")).toBeUndefined();
    // a que já existia continua como estava (não é reimportada nem atualizada)
    expect(await rowByRef(id, "m-existing")).toMatchObject({ description: "Já importada", isMetaCharge: false });

    const rows = await rowsOf(id);
    expect(rows).toHaveLength(500 + 2); // novas + "m-existing" + "px-1" do seed
    expect(rows.filter((r) => r.reference?.startsWith("m-fill-"))).toHaveLength(490);
    expect(rows.filter((r) => r.isMetaCharge).map((r) => r.reference)).toEqual(["m-credit-1", "m-meta-1", "m-p2-meta"]);

    expect(JSON.parse((await syncConfigOf(id))!)).toEqual({ mercuryAccountId: MERCURY_ACCT, mercuryEntity: "activeview" });
  });

  it("guarda a entidade informada no syncConfig", async () => {
    installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    await post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM, entity: "4ads" });
    expect(JSON.parse((await syncConfigOf(acc.mercury.id))!)).toEqual({ mercuryAccountId: MERCURY_ACCT, mercuryEntity: "4ads" });
  });

  it("nada novo: { imported: 0, skipped } sem range e SEM regravar o syncConfig", async () => {
    const fake = installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    await post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM, to: TO });
    await prisma.account.update({ where: { id: acc.mercury.id }, data: { syncConfig: '{"marcador":1}' } });
    fake.reset();
    const res = await post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM, to: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 0, skipped: 503 });
    expect(await syncConfigOf(acc.mercury.id)).toBe('{"marcador":1}');
  });

  it("sem from/to: start = período de sync (Setting) e end = hoje", async () => {
    await prisma.setting.create({ data: { key: "sync.from", value: "2026-08-15" } });
    await prisma.setting.create({ data: { key: "sync.to", value: "2026-08-31" } }); // o "até" NÃO trava
    const fake = installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    const res = await post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT });
    expect((await res.json()).range).toEqual({ start: "2026-08-15", end: today() });
    expect(fake.queries(`${MERCURY_API}/transactions`)[0]).toMatchObject({ start: "2026-08-15", end: today() });
  });

  it("erro do Mercury na paginação: a rota lança (nada gravado)", async () => {
    installFakeBanks({ mercury: { [MERCURY_ACCT]: { ...mercuryFixture(), failPage: 1 } } });
    await expect(post({ accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM })).rejects.toThrow("Mercury API error: 500 mercury boom");
    expect(await rowsOf(acc.mercury.id)).toHaveLength(2);
    expect(await syncConfigOf(acc.mercury.id)).toBeNull();
  });

  it("faltando ids = 400", async () => {
    installFakeBanks({});
    const res = await post({ accountId: acc.mercury.id });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "mercuryAccountId and accountId required" });
  });
});

// ───────────────────────────── Wise ─────────────────────────────

describe("POST /api/sync/wise (caracterização)", () => {
  const post = (json: Record<string, unknown>) => wiseRoute.POST(req("/api/sync/wise", { method: "POST", json }));
  const FROM = "2026-09-01";
  const TO = "2026-10-12";

  it("pagina por nextCursor, resolve transferências/cotação/cartão, grava as linhas marcadas e lembra o perfil", async () => {
    const fake = installFakeBanks({ wise: { [WISE_PROFILE]: wiseFixture() } });
    const res = await post({ accountId: acc.wise.id, profileId: WISE_PROFILE, from: FROM, to: TO });

    expect(res.status).toBe(200);
    // completed = 8 (inclui a repetida e a já existente); novas = 7; 1 sem valor; 5 gravadas (repetida 1x)
    expect(await res.json()).toEqual({ imported: 5, alreadyExisted: 3, parseFailed: 1, totalCompleted: 8, newActivities: 7 });

    const since = `${FROM}T00:00:00.000Z`;
    const until = `${TO}T23:59:59.999Z`;
    expect(fake.queries(`${WISE_API}/v1/profiles/${WISE_PROFILE}/activities`)).toEqual([
      { size: "100", since, until },
      { size: "100", since, until, nextCursor: wiseCursor(1) },
    ]);
    const paths = fake.calls.map((c) => new URL(c.url).pathname).sort();
    expect(paths).toEqual([
      "/v1/borderless-accounts",
      "/v1/profiles/wise-prof-1/activities",
      "/v1/profiles/wise-prof-1/activities",
      "/v1/transfers/70001",
      "/v1/transfers/70002",
      "/v1/transfers/70003",
      "/v2/profiles", // conferência: o perfil é da empresa da conta e não está em outra conta
      "/v3/profiles/wise-prof-1/card-transactions/ct-901", // a atividade repetida busca o detalhe 2x
      "/v3/profiles/wise-prof-1/card-transactions/ct-901",
      "/v3/profiles/wise-prof-1/quotes/q-uuid-1", // cotação só na transferência de SAÍDA
    ]);
    expect(new Set(fake.calls.map((c) => c.auth))).toEqual(new Set(["Bearer tok-wise-pixel"]));
    expect(fake.unexpected).toEqual([]);

    const id = acc.wise.id;
    const base = { cardLabel: null, billAmount: null, billCurrency: null };
    expect(await rowByRef(id, "wise-activity:act-card-meta")).toEqual({
      ...base, reference: "wise-activity:act-card-meta", date: "2026-10-05T12:00:00.000Z", description: "Facebook",
      amount: -55.1, currency: "USD", fee: null, isMetaCharge: true, metaRef: "WQ12ER34TY", cardLast4: "1234",
    });
    expect(await rowByRef(id, "wise-activity:act-transfer-out")).toEqual({
      ...base, reference: "wise-activity:act-transfer-out", date: "2026-10-06T08:00:00.000Z", description: "Meta Platforms Ireland Limited",
      amount: -(1000 + 4.12), currency: "EUR", fee: 4.12, isMetaCharge: false, metaRef: null, cardLast4: null,
    });
    expect(await rowByRef(id, "wise-activity:act-transfer-in")).toEqual({
      ...base, reference: "wise-activity:act-transfer-in", date: "2026-10-07T09:15:00.000Z", description: "Google Ireland",
      amount: 2310.5, currency: "EUR", fee: null, isMetaCharge: false, metaRef: null, cardLast4: null,
    });
    expect(await rowByRef(id, "wise-activity:act-transfer-nodetail")).toEqual({
      ...base, reference: "wise-activity:act-transfer-nodetail", date: "2026-09-20T16:00:00.000Z", description: "Supplier",
      amount: -352.4, currency: "USD", fee: null, isMetaCharge: false, metaRef: null, cardLast4: null,
    });
    expect(await rowByRef(id, "wise-activity:act-topup")).toEqual({
      ...base, reference: "wise-activity:act-topup", date: "2026-09-18T07:00:00.000Z", description: "Topped up",
      amount: 30, currency: "EUR", fee: null, isMetaCharge: false, metaRef: null, cardLast4: null,
    });
    expect(await rowByRef(id, "wise-activity:act-pending")).toBeUndefined();
    expect(await rowByRef(id, "wise-activity:act-unparseable")).toBeUndefined();
    expect(await rowByRef(id, "wise-activity:act-existing")).toMatchObject({ description: "Já importada", amount: -5, cardLast4: null });
    expect(await rowsOf(id)).toHaveLength(6);

    expect(JSON.parse((await syncConfigOf(id))!)).toEqual({ wiseProfileId: WISE_PROFILE });
  });

  it("1ª página com erro: 502 explicando, nada gravado e syncConfig intocado", async () => {
    installFakeBanks({ wise: { [WISE_PROFILE]: { ...wiseFixture(), failPage: 0 } } });
    const res = await post({ accountId: acc.wise.id, profileId: WISE_PROFILE, from: FROM });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'Wise não retornou atividades — HTTP 503: Service Unavailable. (token/perfil ou limite). Não é "0 importadas".',
    });
    expect(await rowsOf(acc.wise.id)).toHaveLength(1);
    expect(await syncConfigOf(acc.wise.id)).toBeNull();
  });

  it("erro numa página seguinte: segue com o que veio (sem erro)", async () => {
    installFakeBanks({ wise: { [WISE_PROFILE]: { ...wiseFixture(), failPage: 1 } } });
    const res = await post({ accountId: acc.wise.id, profileId: WISE_PROFILE, from: FROM });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 3, alreadyExisted: 0, parseFailed: 0, totalCompleted: 3, newActivities: 3 });
  });

  it("sem from/to: since = período de sync, until = agora", async () => {
    await prisma.setting.create({ data: { key: "sync.from", value: "2026-08-15" } });
    const fake = installFakeBanks({ wise: { [WISE_PROFILE]: wiseFixture() } });
    const before = Date.now();
    await post({ accountId: acc.wise.id, profileId: WISE_PROFILE });
    const q = fake.queries(`${WISE_API}/v1/profiles/${WISE_PROFILE}/activities`)[0];
    expect(q.since).toBe("2026-08-15T00:00:00.000Z");
    expect(Date.parse(q.until)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(q.until)).toBeLessThanOrEqual(Date.now());
  });

  it("faltando ids = 400", async () => {
    installFakeBanks({});
    const res = await post({ accountId: acc.wise.id });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "profileId and accountId required" });
  });
});

// ───────────────────────────── Revolut ─────────────────────────────

describe("POST /api/sync/revolut (caracterização)", () => {
  const post = (json: Record<string, unknown>) => revolutRoute.POST(req("/api/sync/revolut", { method: "POST", json }));
  const FROM = "2026-09-01";
  const LABEL_9876 = "BM 14 Snapnork / BM 15 Outro";

  it("pagina movendo o `to`, grava por perna com taxa/cartão/rótulo/bill e faz os backfills", async () => {
    const fx = revolutFixture();
    const fake = installFakeBanks({ revolut: { [REVOLUT_TOKEN]: fx } });
    const before = Date.now();
    const res = await post({ accountId: acc.revolut.id, revolutAccountId: null, from: FROM });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1000, fetched: 1002, skipped: 2, cardsLabeled: 2 });

    const qs = fake.queries(`${REVOLUT_BASE}/transactions`);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ from: `${FROM}T00:00:00Z`, count: "1000" });
    expect(Date.parse(qs[0].to)).toBeGreaterThanOrEqual(before - 1000);
    expect(qs[1]).toEqual({ from: `${FROM}T00:00:00Z`, to: fx.pages[0][999].created_at, count: "1000" });
    expect(fake.calls.filter((c) => c.url === `${REVOLUT_BASE}/cards`)).toHaveLength(1);
    expect(fake.calls).toHaveLength(3);
    expect(new Set(fake.calls.map((c) => c.auth))).toEqual(new Set([`Bearer ${REVOLUT_TOKEN}`]));
    expect(fake.unexpected).toEqual([]);

    const id = acc.revolut.id;
    const base = { cardLabel: null, billAmount: null, billCurrency: null, cardLast4: null, isMetaCharge: false, metaRef: null };
    // valor: negativo soma a taxa; positivo fica como veio. data: completed_at ?? created_at
    expect(await rowByRef(id, "revolut:rtx-meta-1:leg-1")).toEqual({
      ...base, reference: "revolut:rtx-meta-1:leg-1", date: "2026-10-10T03:00:00.000Z", description: "Facebk *RVQ7K2M9P1",
      amount: -93.25, fee: 0.75, currency: "EUR", cardLast4: "9876", cardLabel: LABEL_9876, isMetaCharge: true, metaRef: "RVQ7K2M9P1",
      billAmount: 100, billCurrency: "USD",
    });
    expect(await rowByRef(id, "revolut:rtx-fx-1:leg-a")).toEqual({
      ...base, reference: "revolut:rtx-fx-1:leg-a", date: fx.pages[0][1].created_at, description: "Exchanged to USD",
      amount: -500, fee: 0, currency: "EUR",
    });
    expect(await rowByRef(id, "revolut:rtx-fx-1:leg-b")).toMatchObject({ description: "Exchanged from EUR", amount: 540, fee: 0, currency: "USD" });
    expect(await rowByRef(id, "revolut:rtx-in-1:leg-t")).toMatchObject({ description: "ACME INC", amount: 1000, fee: 2, isMetaCharge: false });
    // só a referência traz o código Meta: metaRef sai, mas isMetaCharge NÃO (referência não entra no teste de Meta)
    expect(await rowByRef(id, "revolut:rtx-ref-1:leg-r")).toMatchObject({ description: "Facebk *REFONLY777", isMetaCharge: false, metaRef: "REFONLY777" });
    expect(await rowByRef(id, "revolut:rtx-bare:leg-x")).toMatchObject({ description: "Revolut", amount: -1, fee: 0 });
    expect(await rowByRef(id, "revolut:rtx-l4:leg-l")).toMatchObject({ cardLast4: "5555", cardLabel: "Cartão Antigo", billAmount: 12, billCurrency: "USD" });
    expect(await rowByRef(id, "revolut:rtx-unknown-card:leg-u")).toMatchObject({ cardLast4: "3333", cardLabel: null });
    expect(await rowByRef(id, "revolut:rtx-upper:leg-up")).toMatchObject({ description: "Maiúsculo" });
    expect(await rowByRef(id, "revolut:rtx-pending:leg-rtx-pending")).toBeUndefined();
    expect(await rowByRef(id, "revolut:rtx-declined:leg-rtx-declined")).toBeUndefined();
    expect(await rowByRef(id, "revolut:rtx-p2-meta:leg-p2")).toMatchObject({
      amount: -10.1, fee: 0.1, cardLast4: "9876", cardLabel: LABEL_9876, isMetaCharge: true, metaRef: "P2REVOLUT9", billAmount: 10,
    });
    expect(await rowByRef(id, "revolut:rtx-fill-0500:leg-f500")).toEqual({
      ...base, reference: "revolut:rtx-fill-0500:leg-f500", date: fx.pages[0][500].created_at, description: "Shop 500", amount: -5, fee: 0, currency: "USD",
    });
    // já existente: não reimporta nem remarca, mas ganha bill (backfill) e o rótulo do cartão (pelos últimos 4)
    expect(await rowByRef(id, "revolut:rtx-existing:leg-e")).toEqual({
      ...base, reference: "revolut:rtx-existing:leg-e", date: "2026-10-01T00:00:00.000Z", description: "Antigo", amount: -40, fee: 0, currency: "EUR",
      cardLast4: "9876", cardLabel: LABEL_9876, billAmount: 45.5, billCurrency: "USD",
    });
    expect(await rowsOf(id)).toHaveLength(1001);

    expect(JSON.parse((await syncConfigOf(id))!)).toEqual({ revolutAccountId: null });
  });

  it("com revolutAccountId: só as pernas daquela conta Revolut", async () => {
    installFakeBanks({ revolut: { [REVOLUT_TOKEN]: revolutFixture() } });
    const res = await post({ accountId: acc.revolut.id, revolutAccountId: "rev-acc-usd", from: FROM });
    expect(await res.json()).toEqual({ imported: 998, fetched: 1002, skipped: 4, cardsLabeled: 2 });
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-meta-1:leg-1")).toBeUndefined();
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-fx-1:leg-a")).toBeUndefined();
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-fx-1:leg-b")).toBeDefined();
    expect(JSON.parse((await syncConfigOf(acc.revolut.id))!)).toEqual({ revolutAccountId: "rev-acc-usd" });
  });

  it("empresa sem Revolut conectado: 401 needsAuth, sem chamar o banco e sem syncConfig", async () => {
    await prisma.credential.deleteMany({ where: { issuer: "revolut" } });
    const fake = installFakeBanks({ revolut: { [REVOLUT_TOKEN]: revolutFixture() } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ accountId: acc.revolut.id, from: FROM });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Revolut da empresa "Pixel Ads LLC" não conectado', needsAuth: true });
    expect(fake.calls).toEqual([]);
    expect(await syncConfigOf(acc.revolut.id)).toBeNull();
  });

  it("erro numa página seguinte: 502 parcial, o que já gravou fica (e o syncConfig já foi salvo)", async () => {
    installFakeBanks({ revolut: { [REVOLUT_TOKEN]: { ...revolutFixture(), failPage: 1 } } });
    const res = await post({ accountId: acc.revolut.id, from: FROM });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Revolut API 500 após importar 998: boom", imported: 998, partial: true });
    expect(await rowsOf(acc.revolut.id)).toHaveLength(999);
    expect(JSON.parse((await syncConfigOf(acc.revolut.id))!)).toEqual({ revolutAccountId: null });
  });

  it("sem from: usa o período de sync", async () => {
    await prisma.setting.create({ data: { key: "sync.from", value: "2026-08-15" } });
    const fake = installFakeBanks({ revolut: { [REVOLUT_TOKEN]: revolutFixture() } });
    await post({ accountId: acc.revolut.id });
    expect(fake.queries(`${REVOLUT_BASE}/transactions`)[0].from).toBe("2026-08-15T00:00:00Z");
  });

  it("sem accountId = 400", async () => {
    installFakeBanks({});
    const res = await post({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "accountId required" });
  });
});
