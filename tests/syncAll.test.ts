import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { REVOLUT_BASE } from "@/lib/revolut";
import { NO_OWN_TOKEN_MESSAGE } from "@/lib/credentials";

// chaves globais do Mercury (KEY_MAP é lido no import) — falsas; um membro NUNCA pode usá-las
vi.mock("@/lib/mercury", () => ({
  MERCURY_BASE: "https://api.mercury.com/api/v1",
  KEY_MAP: { activeview: "chave-global-mercury", "4ads": "chave-global-mercury-4ads" },
}));

import * as syncAll from "@/app/api/sync/all/route";
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
  type FakeBanks,
} from "./bankFakes";

/**
 * POST /api/sync/all usa a MESMA implementação por banco que as rotas /api/sync/{mercury,wise,revolut}:
 * mesmas linhas marcadas (Meta, cartão, operação, bill), mesma paginação, mesmo escopo e mesmas
 * regras de token (membro: só a credencial da própria conta/empresa; legados só p/ superadmin).
 */

const FROM = "2026-09-01";
const OUTRO_REVOLUT_TOKEN = "rev-access-outro";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let acc: Awaited<ReturnType<typeof seedBankAccounts>>;
let outro: { mercury: string; wise: string; revolut: string };

beforeEach(async () => {
  resetRequest();
  await prisma.setting.deleteMany();
  s = await seedTwoGroups();
  acc = await seedBankAccounts(s);
  await seedExistingBankRows({ mercury: acc.mercury.id, wise: acc.wise.id, revolut: acc.revolut.id });
  // o que a tela salva em syncConfig (PATCH /api/accounts/[id] e as rotas por banco)
  await prisma.account.update({ where: { id: acc.mercury.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: MERCURY_ACCT, mercuryEntity: "activeview" }) } });
  await prisma.account.update({ where: { id: acc.wise.id }, data: { syncConfig: JSON.stringify({ wiseProfileId: WISE_PROFILE }) } });
  await prisma.account.update({ where: { id: acc.revolut.id }, data: { syncConfig: JSON.stringify({ revolutAccountId: null }) } });

  // OUTRO grupo: contas sincronizáveis, com token próprio e credenciais da empresa dele
  const co = s.companies.outro;
  await prisma.account.update({ where: { id: s.accounts.outro.id }, data: { apiToken: "tok-outro-conta", syncConfig: JSON.stringify({ mercuryAccountId: "merc-outro" }) } });
  const outroWise = await prisma.account.create({
    data: { companyId: co.id, bank: "Wise", currency: "EUR", name: "Wise Outro 2", apiToken: "tok-outro-wise-conta", syncConfig: JSON.stringify({ wiseProfileId: "wise-prof-outro" }) },
  });
  const outroRev = await prisma.account.create({
    data: { companyId: co.id, bank: "Revolut", currency: "EUR", name: "Revolut Outro", syncConfig: JSON.stringify({ revolutAccountId: null }) },
  });
  outro = { mercury: s.accounts.outro.id, wise: outroWise.id, revolut: outroRev.id };
  await prisma.credential.create({ data: { issuer: "mercury", company: co.name, token: "tok-outro-cred-mercury" } });
  await prisma.credential.create({ data: { issuer: "wise", company: co.name, token: "tok-outro-cred-wise" } });
  await prisma.credential.create({
    data: {
      issuer: "revolut", company: co.id, token: "refresh-outro",
      secrets: JSON.stringify({ clientId: "cli-outro", redirectUri: "https://app.teste/api/revolut/callback", accessToken: OUTRO_REVOLUT_TOKEN, accessExp: Math.floor(Date.now() / 1000) + 3600 }),
    },
  });

  // chaves globais no ambiente — só o superadmin pode cair nelas
  vi.stubEnv("MERCURY_API_KEY", "env-global-mercury");
  vi.stubEnv("MERCURY_API_TOKEN", "env-token-mercury");
  vi.stubEnv("WISE_API_TOKEN", "env-token-wise");
  vi.stubEnv("WISE_API_KEY", "env-global-wise");
  vi.stubEnv("WISE_API_KEY_ACTIVEVIEW_LLC", "env-global-wise-av");
  vi.stubEnv("REVOLUT_ACCESS_TOKEN", "env-token-revolut");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const emptyWise = () => ({ ownRecipientId: 1, pages: [[]], transfers: {}, quotes: {}, cardTransactions: {} });

/** Mesmos dados nos bancos falsos para as contas da Pixel e as do outro grupo (se forem tentadas, funcionam). */
const banks = (): FakeBanks => ({
  mercury: { [MERCURY_ACCT]: mercuryFixture(), "merc-outro": mercuryFixture(), "merc-pixel-sem-token": { pages: [[]], cards: [] } },
  wise: { [WISE_PROFILE]: wiseFixture(), "wise-prof-outro": { ...wiseFixture(), profileName: "Outra Empresa LTDA" }, "wise-sem-token": { ...emptyWise(), profileName: "Pixel Ads LLC" } },
  revolut: { [REVOLUT_TOKEN]: revolutFixture(), [OUTRO_REVOLUT_TOKEN]: revolutFixture() },
});

type AccountResult = { accountId: string; accountName: string; imported: number; skipped: number; error?: string };
const runAll = async (json: Record<string, unknown> = { from: FROM }) => {
  const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json }));
  const body = (await res.json()) as { imported: number; skipped: number; accounts: AccountResult[]; error?: string };
  const byId = new Map((body.accounts ?? []).map((a) => [a.accountId, a]));
  return { status: res.status, body, byId };
};
const syncConfigs = async () =>
  (await prisma.account.findMany({ select: { id: true, syncConfig: true }, orderBy: { id: "asc" } })).map((a) => [a.id, a.syncConfig]);

/** Contas Pixel sem credencial própria (nem token na conta nem credencial da empresa Pixel). */
async function seedTokenlessPixelAccounts() {
  const merc = await prisma.account.create({
    data: { companyId: s.companies.pixel.id, bank: "Mercury", currency: "USD", name: "Mercury Pixel sem token", syncConfig: JSON.stringify({ mercuryAccountId: "merc-pixel-sem-token" }) },
  });
  const wise = await prisma.account.create({
    data: { companyId: s.companies.pixel.id, bank: "Wise", currency: "USD", name: "Wise Pixel sem token", syncConfig: JSON.stringify({ wiseProfileId: "wise-sem-token" }) },
  });
  return { merc, wise };
}

describe("POST /api/sync/all — mesma implementação das rotas por banco", () => {
  it("grava as MESMAS linhas marcadas que as rotas por banco (Meta, cartão, operação, bill) e pagina", async () => {
    await prisma.transaction.deleteMany({ where: { reference: "px-1" } }); // só as linhas do banco falso
    loginAs(s.users.pixel);
    const fake = installFakeBanks(banks());

    // 1) rotas por banco
    expect((await mercuryRoute.POST(req("/api/sync/mercury", { method: "POST", json: { accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: FROM } }))).status).toBe(200);
    expect((await wiseRoute.POST(req("/api/sync/wise", { method: "POST", json: { accountId: acc.wise.id, profileId: WISE_PROFILE, from: FROM } }))).status).toBe(200);
    expect((await revolutRoute.POST(req("/api/sync/revolut", { method: "POST", json: { accountId: acc.revolut.id, revolutAccountId: null, from: FROM } }))).status).toBe(200);
    const viaRoutes = { mercury: await rowsOf(acc.mercury.id), wise: await rowsOf(acc.wise.id), revolut: await rowsOf(acc.revolut.id) };

    // 2) mesmo ponto de partida → sync/all
    await prisma.transaction.deleteMany({ where: { accountId: { in: [acc.mercury.id, acc.wise.id, acc.revolut.id] } } });
    await seedExistingBankRows({ mercury: acc.mercury.id, wise: acc.wise.id, revolut: acc.revolut.id });
    const configsBefore = await syncConfigs();
    fake.reset();
    const { status, body, byId } = await runAll();

    expect(status).toBe(200);
    const viaAll = { mercury: await rowsOf(acc.mercury.id), wise: await rowsOf(acc.wise.id), revolut: await rowsOf(acc.revolut.id) };
    expect(viaAll).toEqual(viaRoutes);

    // as marcas que importam p/ a conciliação Meta estão lá
    expect(await rowByRef(acc.mercury.id, "m-meta-1")).toMatchObject({ isMetaCharge: true, metaRef: "A1B2C3D4E5", cardLast4: "4242", operationId: s.operations.pixel.id, description: "FACEBK *A1B2C3D4E5" });
    expect(await rowByRef(acc.mercury.id, "m-p2-meta")).toMatchObject({ isMetaCharge: true, metaRef: "zz99yy88xx" }); // veio da 2ª página
    expect(await rowByRef(acc.wise.id, "wise-activity:act-card-meta")).toMatchObject({ isMetaCharge: true, metaRef: "WQ12ER34TY", cardLast4: "1234", operationId: s.operations.pixel.id });
    expect(await rowByRef(acc.wise.id, "wise-activity:act-transfer-out")).toMatchObject({ fee: 4.12, currency: "EUR" });
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-meta-1:leg-1")).toMatchObject({
      isMetaCharge: true, metaRef: "RVQ7K2M9P1", cardLast4: "9876", cardLabel: "BM 14 Snapnork / BM 15 Outro", billAmount: 100, billCurrency: "USD", fee: 0.75, amount: -93.25,
    });
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-p2-meta:leg-p2")).toMatchObject({ isMetaCharge: true, metaRef: "P2REVOLUT9" }); // 2ª página
    expect(await rowByRef(acc.revolut.id, "revolut:rtx-existing:leg-e")).toMatchObject({ billAmount: 45.5, cardLabel: "BM 14 Snapnork / BM 15 Outro" });

    // paginação igual à das rotas
    expect(fake.queries(`${MERCURY_API}/transactions`).map((q) => q.start_after ?? null)).toEqual([null, "m-fill-489"]);
    expect(fake.queries(`${WISE_API}/v1/profiles/${WISE_PROFILE}/activities`).map((q) => q.nextCursor ?? null)).toEqual([null, wiseCursor(1)]);
    expect(fake.queries(`${REVOLUT_BASE}/transactions`)).toHaveLength(2);
    expect(fake.unexpected).toEqual([]);

    // resposta: totais + uma linha por conta (formato que /fechamento e a tela leem)
    expect(body.error).toBeUndefined();
    expect(body.imported).toBe(500 + 5 + 1000);
    expect(body.skipped).toBe(3 + 3 + 2);
    expect(byId.get(acc.mercury.id)).toMatchObject({ accountName: "Mercury Pixel", imported: 500, skipped: 3 });
    expect(byId.get(acc.wise.id)).toMatchObject({ accountName: "Wise Pixel", imported: 5, skipped: 3 });
    expect(byId.get(acc.revolut.id)).toMatchObject({ accountName: "Revolut Pixel", imported: 1000, skipped: 2 });
    for (const a of body.accounts) expect(a.error).toBeUndefined();

    // o sync/all só LÊ o syncConfig salvo
    expect(await syncConfigs()).toEqual(configsBefore);
  });

  it("membro: só as contas do grupo; conta sem credencial própria = erro SÓ dela; nunca credencial alheia nem chave global", async () => {
    const tokenless = await seedTokenlessPixelAccounts();
    loginAs(s.users.pixel);
    const fake = installFakeBanks(banks());
    const { status, body, byId } = await runAll();

    expect(status).toBe(200);
    expect([...byId.keys()].sort()).toEqual([acc.mercury.id, acc.wise.id, acc.revolut.id, tokenless.merc.id, tokenless.wise.id].sort());
    expect(byId.get(tokenless.merc.id)).toMatchObject({ imported: 0, skipped: 0, error: NO_OWN_TOKEN_MESSAGE });
    expect(byId.get(tokenless.wise.id)).toMatchObject({ imported: 0, skipped: 0, error: NO_OWN_TOKEN_MESSAGE });
    for (const id of [acc.mercury.id, acc.wise.id, acc.revolut.id]) {
      expect(byId.get(id)?.error).toBeUndefined();
      expect(byId.get(id)?.imported).toBeGreaterThan(0);
    }
    expect(body.imported).toBe(500 + 5 + 1000);

    // só os tokens das PRÓPRIAS contas/empresa; nada do outro grupo nem das chaves globais
    expect(new Set(fake.calls.map((c) => c.auth))).toEqual(new Set(["Bearer tok-merc-pixel", "Bearer tok-wise-pixel", `Bearer ${REVOLUT_TOKEN}`]));
    for (const banned of ["merc-outro", "wise-prof-outro", "merc-pixel-sem-token", "wise-sem-token"]) {
      expect(fake.calls.filter((c) => c.url.includes(banned))).toEqual([]);
    }
    expect(fake.unexpected).toEqual([]);

    // contas do outro grupo intactas
    expect(await prisma.transaction.count({ where: { accountId: outro.mercury } })).toBe(1);
    expect(await prisma.transaction.count({ where: { accountId: { in: [outro.wise, outro.revolut] } } })).toBe(0);
  });

  it("operador (só a operação) com filtro de empresa: só as contas da operação dele", async () => {
    loginAs(s.users.operador);
    const fake = installFakeBanks(banks());
    const { status, byId } = await runAll({ from: FROM, company: s.companies.pixel.id });
    expect(status).toBe(200);
    expect([...byId.keys()].sort()).toEqual([acc.mercury.id, acc.wise.id].sort()); // Revolut Pixel não é da operação
    expect(fake.calls.filter((c) => c.url.startsWith(REVOLUT_BASE))).toEqual([]);
    expect(new Set(fake.calls.map((c) => c.auth))).toEqual(new Set(["Bearer tok-merc-pixel", "Bearer tok-wise-pixel"]));
  });

  it("uma conta só (accountId): sincroniza só ela; conta de outro grupo = 404 sem chamar banco", async () => {
    loginAs(s.users.pixel);
    const fake = installFakeBanks(banks());
    const { status, body } = await runAll({ from: FROM, accountId: acc.wise.id });
    expect(status).toBe(200);
    expect(body.accounts.map((a) => a.accountId)).toEqual([acc.wise.id]);
    const outra = await prisma.account.findFirstOrThrow({ where: { companyId: s.companies.outro.id } });
    const chamadas = fake.calls.length;
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: { accountId: outra.id } }));
    expect(res.status).toBe(404);
    expect(fake.calls.length).toBe(chamadas);
  });

  it("depois do sync, 'Possui Fatura' é recalculado: cobrança cujo PDF já estava aqui sai casada", async () => {
    loginAs(s.users.pixel);
    installFakeBanks(banks());
    const tx = await prisma.transaction.create({
      data: { accountId: acc.mercury.id, date: new Date("2026-10-02"), description: "FACEBK *zzz111", amount: -5, currency: "USD", reference: "pre-existente", isMetaCharge: true, metaRef: "zzz111", hasReceipt: false },
    });
    await prisma.metaReceipt.create({ data: { transactionId: "pdf-zzz", referenceNumber: "ZZZ111" } });
    const { status, body } = await runAll({ from: FROM });
    expect(status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).hasReceipt).toBe(true);
    expect((body as unknown as { faturas: { comFatura: number } }).faturas.comFatura).toBeGreaterThanOrEqual(1);
  });

  it("empresa de outro grupo = 404, sem chamar banco nenhum", async () => {
    loginAs(s.users.pixel);
    const fake = installFakeBanks(banks());
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: { company: s.companies.outro.id } }));
    expect(res.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("superadmin: todas as contas; sem token próprio cai nos legados (igual às rotas por banco)", async () => {
    const tokenless = await seedTokenlessPixelAccounts();
    loginAs(s.users.root);
    const fake = installFakeBanks(banks());
    const { status, byId } = await runAll();
    expect(status).toBe(200);
    expect(byId.size).toBe(8);
    for (const a of byId.values()) expect([a.accountName, a.error]).toEqual([a.accountName, undefined]);
    const authFor = (frag: string) => new Set(fake.calls.filter((c) => c.url.includes(frag)).map((c) => c.auth));
    expect(authFor("merc-outro")).toEqual(new Set(["Bearer tok-outro-conta"])); // token da própria conta primeiro
    expect(authFor("merc-pixel-sem-token").size).toBe(1); // legado (superadmin)
    expect(authFor("wise-sem-token").size).toBe(1);
    expect(fake.calls.some((c) => c.auth === `Bearer ${OUTRO_REVOLUT_TOKEN}`)).toBe(true); // Revolut: OAuth da empresa da conta
    expect(byId.get(tokenless.merc.id)).toMatchObject({ imported: 0 });
  });

  it("falha de um banco vira erro SÓ daquela conta; as outras seguem", async () => {
    await prisma.credential.deleteMany({ where: { issuer: "revolut", company: s.companies.pixel.id } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    loginAs(s.users.pixel);
    const b = banks();
    b.mercury![MERCURY_ACCT].failPage = 1;
    installFakeBanks(b);
    const { status, body, byId } = await runAll();
    expect(status).toBe(200);
    expect(byId.get(acc.mercury.id)).toMatchObject({ imported: 0, skipped: 0, error: "Mercury API error: 500 mercury boom" });
    expect(byId.get(acc.revolut.id)).toMatchObject({ imported: 0, error: 'Revolut da empresa "Pixel Ads LLC" não conectado' });
    expect(byId.get(acc.wise.id)).toMatchObject({ imported: 5 });
    expect(body.imported).toBe(5);
    expect(await rowsOf(acc.mercury.id)).toHaveLength(2); // nada gravado (só px-1 e m-existing)
  });

  it("Revolut de conta com operação: rota e sync/all gravam a operação da conta em cada linha", async () => {
    await prisma.account.update({ where: { id: acc.revolut.id }, data: { operationId: s.operations.pixel.id } });
    loginAs(s.users.pixel);
    installFakeBanks(banks());
    await revolutRoute.POST(req("/api/sync/revolut", { method: "POST", json: { accountId: acc.revolut.id, revolutAccountId: null, from: FROM } }));
    const newRows = async () => (await rowsOf(acc.revolut.id)).filter((r) => r.reference !== "revolut:rtx-existing:leg-e");
    const viaRoute = await newRows();
    expect(viaRoute).toHaveLength(1000);
    expect(viaRoute.every((r) => r.operationId === s.operations.pixel.id)).toBe(true);

    await prisma.transaction.deleteMany({ where: { accountId: acc.revolut.id, reference: { not: "revolut:rtx-existing:leg-e" } } });
    await prisma.account.updateMany({ where: { id: { in: [acc.mercury.id, acc.wise.id] } }, data: { syncConfig: null } }); // só o Revolut
    const { byId } = await runAll();
    expect([...byId.keys()]).toEqual([acc.revolut.id]);
    expect(await newRows()).toEqual(viaRoute);
  });

  it("syncConfig inválido vira erro da conta (não derruba o sync)", async () => {
    await prisma.account.update({ where: { id: acc.revolut.id }, data: { syncConfig: "{}" } });
    await prisma.account.update({ where: { id: acc.wise.id }, data: { syncConfig: "não é json" } });
    loginAs(s.users.pixel);
    installFakeBanks(banks());
    const { status, byId } = await runAll();
    expect(status).toBe(200);
    expect(byId.get(acc.revolut.id)).toMatchObject({ imported: 0, skipped: 0, error: "Config inválida" });
    expect(byId.get(acc.wise.id)).toMatchObject({ imported: 0, skipped: 0, error: "Config inválida" });
    expect(byId.get(acc.mercury.id)).toMatchObject({ imported: 500 });
  });
});
