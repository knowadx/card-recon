import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

// chave global do Mercury (KEY_MAP é lido no import do módulo) — fixa e falsa, nunca vai pra rede
vi.mock("@/lib/mercury", () => ({
  MERCURY_BASE: "https://api.mercury.com/api/v1",
  KEY_MAP: { activeview: "chave-global-mercury-teste", "4ads": undefined },
}));

import * as cleanOrphan from "@/app/api/admin/clean-orphan-charges/route";
import * as cleanStale from "@/app/api/admin/clean-stale-accounts/route";
import * as findDuplicates from "@/app/api/admin/find-duplicates/route";
import * as importReceipts from "@/app/api/admin/import-receipts/route";
import * as importRevolutCsv from "@/app/api/admin/import-revolut-csv/route";
import * as metaAudit from "@/app/api/admin/meta-accounts-audit/route";
import * as metarefAnalyze from "@/app/api/admin/metaref-analyze/route";
import * as metarefDump from "@/app/api/admin/metaref-dump/route";
import * as recompute from "@/app/api/admin/recompute-receipts/route";
import * as syncAll from "@/app/api/sync/all/route";
import * as syncStatus from "@/app/api/sync/status/route";
import * as syncMercury from "@/app/api/sync/mercury/route";
import * as syncMercuryAccounts from "@/app/api/sync/mercury/accounts/route";
import * as syncWise from "@/app/api/sync/wise/route";
import * as syncWiseAccounts from "@/app/api/sync/wise/accounts/route";
import * as syncWiseProfiles from "@/app/api/sync/wise/profiles/route";
import * as syncRevolut from "@/app/api/sync/revolut/route";
import * as revolutAuth from "@/app/api/revolut/auth/route";
import * as revolutAccounts from "@/app/api/revolut/accounts/route";
import * as revolutStatus from "@/app/api/revolut/status/route";
import * as revolutDebug from "@/app/api/revolut/debug/route";
import * as revolutDiag from "@/app/api/revolut/diag/route";
import * as revolutCallback from "@/app/api/revolut/callback/route";
import * as wiseAuth from "@/app/api/wise/auth/route";
import * as wiseCallback from "@/app/api/wise/callback/route";
import * as wiseStatus from "@/app/api/wise/status/route";
import * as wiseDebug from "@/app/api/wise/debug/route";
import * as userById from "@/app/api/users/[id]/route";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;

/** Toda chamada "de rede" cai aqui: registra a URL e responde vazio. Nada sai da máquina. */
let fetched: string[] = [];
let fetchReply: (url: string) => Response = () => Response.json({ transactions: [], cards: [] });
const urlOf = (input: unknown) =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

beforeEach(async () => {
  resetRequest();
  fetched = [];
  fetchReply = () => Response.json({ transactions: [], cards: [] });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = urlOf(input);
    fetched.push(url);
    return fetchReply(url);
  }));
  // tabelas que o seedTwoGroups não limpa
  await prisma.metaBillingCharge.deleteMany();
  await prisma.metaAdAccount.deleteMany();
  await prisma.metaReceipt.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.setting.deleteMany();
  s = await seedTwoGroups();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────────────────────────── admin/* ─────────────────────────────

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CSV = `ID,Description,Card number,Card label,Date completed (UTC)\n${UUID},Facebk *abcd123xyz,****1234,BM 1,2026-10-01\n`;

async function seedAdminData() {
  await prisma.transaction.create({
    data: { accountId: s.accounts.pixel.id, date: new Date("2026-10-01"), description: "Meta Pay", amount: -50, currency: "USD", reference: `revolut:${UUID}:leg1`, isMetaCharge: true },
  });
  await prisma.metaAdAccount.create({ data: { accountId: "111", name: "Conta viva", operationId: s.operations.pixel.id } });
  await prisma.metaAdAccount.create({ data: { accountId: "222", name: "Conta velha" } }); // sem operação e sem cobrança → "stale"
  await prisma.metaBillingCharge.create({
    data: { transactionId: "ch-1", accountId: "999", amountUsd: 10, currency: "USD", chargedAt: new Date("2026-10-01") }, // órfã
  });
  await prisma.metaReceipt.create({ data: { transactionId: "r-0", referenceNumber: "zzz" } });
}

async function snapshot() {
  return {
    schema: await prisma.$queryRawUnsafe(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
    indexes: await prisma.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
    tx: await prisma.transaction.findMany({ orderBy: { id: "asc" } }),
    metaAd: await prisma.metaAdAccount.findMany({ orderBy: { id: "asc" } }),
    charges: await prisma.metaBillingCharge.findMany({ orderBy: { id: "asc" } }),
    receipts: await prisma.metaReceipt.findMany({ orderBy: { id: "asc" } }),
  };
}

const adminCalls: Array<[string, () => Promise<Response>]> = [
  ["clean-orphan-charges GET ?apply=1", () => cleanOrphan.GET(req("/api/admin/clean-orphan-charges?apply=1"))],
  ["clean-stale-accounts GET ?apply=1", () => cleanStale.GET(req("/api/admin/clean-stale-accounts?apply=1"))],
  ["find-duplicates GET", () => findDuplicates.GET()],
  ["meta-accounts-audit GET", () => metaAudit.GET()],
  ["metaref-analyze GET", () => metarefAnalyze.GET()],
  ["metaref-dump GET", () => metarefDump.GET()],
  ["recompute-receipts GET", () => recompute.GET()],
  ["recompute-receipts POST", () => recompute.POST()],
];

describe("/api/admin/* — só o administrador geral", () => {
  it.each(adminCalls)("membro em %s = 403 e o banco não muda", async (_name, call) => {
    await seedAdminData();
    const before = await snapshot();
    loginAs(s.users.pixel);
    expect((await call()).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it.each(adminCalls)("operador e sem vínculo em %s = 403", async (_name, call) => {
    loginAs(s.users.operador);
    expect((await call()).status).toBe(403);
    loginAs(s.users.semAcesso);
    expect((await call()).status).toBe(403);
  });

  it.each(adminCalls)("deslogado em %s = 401", async (_name, call) => {
    loginAs(null);
    expect((await call()).status).toBe(401);
  });

  it("superadmin continua usando (dry-run e leituras) e o import do CSV grava", async () => {
    await seedAdminData();
    loginAs(s.users.root);
    const dry = await cleanOrphan.GET(req("/api/admin/clean-orphan-charges"));
    expect(dry.status).toBe(200);
    expect((await dry.json()).cobrancasOrfas).toBe(1);
    expect((await findDuplicates.GET()).status).toBe(200);
    expect((await metarefDump.GET()).status).toBe(200);
    const csv = await importRevolutCsv.POST(new Request("http://localhost/api/admin/import-revolut-csv", { method: "POST", body: CSV }));
    expect(csv.status).toBe(200);
    expect((await prisma.transaction.findFirst({ where: { reference: `revolut:${UUID}:leg1` } }))?.metaRef).toBe("abcd123xyz");
  });
});

// ─────────── passos 2 e 4 do Fechamento Meta: superadmin E admins (decisão do dono em 2026-10-16) ───────────

const importCalls: [string, () => Promise<Response>][] = [
  ["import-receipts POST", () => importReceipts.POST(req("/api/admin/import-receipts", { method: "POST", json: [{ transactionId: "r-1", referenceNumber: "abcd123xyz" }] }))],
  ["import-revolut-csv POST", () => importRevolutCsv.POST(new Request("http://localhost/api/admin/import-revolut-csv", { method: "POST", headers: { "content-type": "text/csv" }, body: CSV }))],
];

describe("importar CSV da Revolut e faturas (PDF) — admins também", () => {
  const adminDe = async (holdingId: string, email: string) => {
    const u = await prisma.user.create({ data: { email, role: "admin" } });
    await prisma.membership.create({ data: { userId: u.id, holdingId } });
    return u;
  };

  it.each(importCalls)("membro, operador e sem vínculo em %s = 403 e o banco não muda; deslogado = 401", async (_name, call) => {
    await seedAdminData();
    const before = await snapshot();
    for (const u of [s.users.pixel, s.users.operador, s.users.semAcesso]) {
      loginAs(u);
      expect((await call()).status).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
    loginAs(null);
    expect((await call()).status).toBe(401);
  });

  it.each(importCalls)("admin do grupo em %s = 200", async (_name, call) => {
    await seedAdminData();
    loginAs(await adminDe(s.holdings.pixel.id, "adm-px@teste.com"));
    expect((await call()).status).toBe(200);
  });

  it("CSV de um admin só grava código nas transações do grupo DELE (superadmin grava em todas)", async () => {
    // a transação com o UUID do CSV é do OUTRO grupo
    const alheia = await prisma.transaction.create({
      data: { accountId: s.accounts.outro.id, date: new Date("2026-10-01"), description: "Meta Pay", amount: -50, currency: "USD", reference: `revolut:${UUID}:leg1`, isMetaCharge: true },
    });
    const csv = () => importRevolutCsv.POST(new Request("http://localhost/api/admin/import-revolut-csv", { method: "POST", body: CSV }));
    loginAs(await adminDe(s.holdings.pixel.id, "adm-px@teste.com"));
    expect((await csv()).status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: alheia.id } })).metaRef).toBeNull();
    loginAs(s.users.root);
    expect((await csv()).status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: alheia.id } })).metaRef).toBe("abcd123xyz");
  });
});

// ───────────────────────────── sync de bancos ─────────────────────────────

/** Configura sync (Mercury) nas contas: Pixel (da operação), Pixel 2 (só da holding) e Outro. */
async function seedSync() {
  // credencial Mercury da PRÓPRIA empresa Pixel: membro nunca sincroniza pela chave global (KEY_MAP)
  await prisma.credential.create({ data: { issuer: "mercury", company: s.companies.pixel.name, token: "tok-pixel-cred" } });
  await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: "merc-pixel" }) } });
  await prisma.account.update({ where: { id: s.accounts.outro.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: "merc-outro" }) } });
  const pixel2 = await prisma.account.create({
    data: { companyId: s.companies.pixel.id, bank: "Mercury", currency: "USD", name: "Mercury Pixel 2", syncConfig: JSON.stringify({ mercuryAccountId: "merc-pixel2" }) },
  });
  return { pixel2 };
}

/** Quais contas Mercury o sync tentou buscar no banco (pelo ?accountId= da URL). */
const mercuryAttempts = () =>
  fetched
    .filter((u) => u.startsWith("https://api.mercury.com/api/v1/transactions"))
    .map((u) => new URL(u).searchParams.get("accountId"))
    .sort();

const bodyIds = async (res: Response) =>
  ((await res.json()).accounts as { accountId: string }[]).map((a) => a.accountId).sort();

describe("POST /api/sync/all", () => {
  it("membro da holding sincroniza só as contas do grupo dele", async () => {
    const { pixel2 } = await seedSync();
    loginAs(s.users.pixel);
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: {} }));
    expect(res.status).toBe(200);
    expect(await bodyIds(res)).toEqual([s.accounts.pixel.id, pixel2.id].sort());
    expect(mercuryAttempts()).toEqual(["merc-pixel", "merc-pixel2"]);
  });

  it("membro da operação sincroniza só a conta da operação (nem a outra conta da mesma empresa)", async () => {
    await seedSync();
    loginAs(s.users.operador);
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: { company: s.companies.pixel.id } }));
    expect(res.status).toBe(200);
    expect(await bodyIds(res)).toEqual([s.accounts.pixel.id]);
    expect(mercuryAttempts()).toEqual(["merc-pixel"]);
  });

  it("empresa de outro grupo = 404, sem chamar banco nenhum", async () => {
    await seedSync();
    loginAs(s.users.pixel);
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: { company: s.companies.outro.id } }));
    expect(res.status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it("sem vínculo: nenhuma conta (400), sem chamar banco nenhum", async () => {
    await seedSync();
    loginAs(s.users.semAcesso);
    expect((await syncAll.POST(req("/api/sync/all", { method: "POST", json: {} }))).status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("superadmin continua sincronizando todas", async () => {
    await seedSync();
    loginAs(s.users.root);
    const res = await syncAll.POST(req("/api/sync/all", { method: "POST", json: {} }));
    expect(res.status).toBe(200);
    expect(mercuryAttempts()).toEqual(["merc-outro", "merc-pixel", "merc-pixel2"]);
  });

  it("deslogado = 401", async () => {
    await seedSync();
    loginAs(null);
    expect((await syncAll.POST(req("/api/sync/all", { method: "POST", json: {} }))).status).toBe(401);
    expect(fetched).toEqual([]);
  });
});

describe("sync de UMA conta (mercury / wise / revolut)", () => {
  const calls = (accountId: string): Array<[string, () => Promise<Response>]> => [
    ["mercury", () => syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId, mercuryAccountId: "merc-x" } }))],
    ["wise", () => syncWise.POST(req("/api/sync/wise", { method: "POST", json: { accountId, profileId: "123" } }))],
    ["revolut", () => syncRevolut.POST(req("/api/sync/revolut", { method: "POST", json: { accountId, revolutAccountId: null } }))],
  ];

  it("conta de outro grupo = 404, sem chamar o banco e sem gravar nada", async () => {
    await prisma.account.update({ where: { id: s.accounts.outro.id }, data: { apiToken: "token-do-outro" } });
    loginAs(s.users.pixel);
    for (const [name, call] of calls(s.accounts.outro.id)) {
      expect([name, (await call()).status]).toEqual([name, 404]);
    }
    expect(fetched).toEqual([]);
    const outro = await prisma.account.findUnique({ where: { id: s.accounts.outro.id } });
    expect(outro?.syncConfig).toBeNull();
    expect(await prisma.transaction.count({ where: { accountId: s.accounts.outro.id } })).toBe(1);
  });

  it("deslogado = 401", async () => {
    loginAs(null);
    for (const [name, call] of calls(s.accounts.pixel.id)) {
      expect([name, (await call()).status]).toEqual([name, 401]);
    }
    expect(fetched).toEqual([]);
  });

  it("a própria conta sincroniza normalmente (banco simulado)", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "token-pixel" } });
    fetchReply = (url) =>
      url.includes("/transactions")
        ? Response.json({ transactions: [{ id: "mtx-1", counterpartyName: "Fornecedor", bankDescription: null, merchantName: null, amount: -10, postedAt: "2026-10-02T00:00:00Z", createdAt: "2026-10-02T00:00:00Z", status: "sent", note: null, externalMemo: null, kind: "x" }] })
        : Response.json({ cards: [] });
    loginAs(s.users.pixel);
    const res = await syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId: s.accounts.pixel.id, mercuryAccountId: "merc-pixel" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
    expect(await prisma.transaction.count({ where: { accountId: s.accounts.pixel.id, reference: "mtx-1" } })).toBe(1);
    expect(fetched.every((u) => u.includes("merc-pixel"))).toBe(true);
  });
});

describe("GET /api/sync/status", () => {
  it("só traz as contas do escopo", async () => {
    const { pixel2 } = await seedSync();
    loginAs(s.users.pixel);
    const res = await syncStatus.GET();
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual([s.accounts.pixel.id, pixel2.id].sort());

    loginAs(s.users.outro);
    expect(Object.keys(await (await syncStatus.GET()).json())).toEqual([s.accounts.outro.id]);

    loginAs(null);
    expect((await syncStatus.GET()).status).toBe(401);
  });
});

describe("listas do banco para configurar o sync", () => {
  const lists = [
    ["mercury/accounts", syncMercuryAccounts.GET],
    ["wise/accounts", syncWiseAccounts.GET],
    ["wise/profiles", syncWiseProfiles.GET],
  ] as const;

  it("conta de outro grupo = 404 e sem conta (chaves de todos / globais) = 403, sem chamar o banco", async () => {
    await prisma.account.update({ where: { id: s.accounts.outro.id }, data: { apiToken: "token-do-outro" } });
    loginAs(s.users.pixel);
    for (const [name, GET] of lists) {
      expect([name, (await GET(req(`/api/sync/x?accountId=${s.accounts.outro.id}`))).status]).toEqual([name, 404]);
      expect([name, (await GET(req("/api/sync/x"))).status]).toEqual([name, 403]);
    }
    expect(fetched).toEqual([]);
  });

  it("Wise: conta própria SEM token cairia na chave global = 403; com token próprio lista", async () => {
    loginAs(s.users.pixel);
    const own = `/api/sync/x?accountId=${s.accounts.pixel.id}`;
    expect((await syncWiseAccounts.GET(req(own))).status).toBe(403);
    expect((await syncWiseProfiles.GET(req(own))).status).toBe(403);
    expect(fetched).toEqual([]);

    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "token-pixel" } });
    fetchReply = () => Response.json([{ id: 7, type: "BUSINESS", details: { businessName: "Pixel Ads LLC" } }]);
    const res = await syncWiseAccounts.GET(req(own));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "7", label: "Pixel Ads LLC" }]);
  });

  it("deslogado = 401", async () => {
    loginAs(null);
    for (const [name, GET] of lists) {
      expect([name, (await GET(req(`/api/sync/x?accountId=${s.accounts.pixel.id}`))).status]).toEqual([name, 401]);
    }
  });
});

// ───────────────────────────── integrações Revolut / Wise ─────────────────────────────

const callbackReq = (qs: string) => new NextRequest(`http://localhost/api/revolut/callback?${qs}`);

const integrationCalls = (): Array<[string, () => Promise<Response>]> => [
  ["revolut/auth", () => revolutAuth.GET(req(`/api/revolut/auth?company=${encodeURIComponent("Pixel Ads LLC")}&client_id=cli`))],
  ["revolut/accounts", () => revolutAccounts.GET(req(`/api/revolut/accounts?accountId=${s.accounts.pixel.id}`))],
  ["revolut/status", () => revolutStatus.GET()],
  ["revolut/debug", () => revolutDebug.GET(req(`/api/revolut/debug?company=${encodeURIComponent("Pixel Ads LLC")}`))],
  ["revolut/diag", () => revolutDiag.GET(req("/api/revolut/diag"))],
  ["revolut/callback", () => revolutCallback.GET(callbackReq(`code=abc&state=${encodeURIComponent("Pixel Ads LLC")}`))],
  ["wise/auth", () => wiseAuth.GET()],
  ["wise/callback", () => wiseCallback.GET(new NextRequest("http://localhost/api/wise/callback?state=s1&code=abc", { headers: { cookie: "oauth_state_wise=s1" } }))],
  ["wise/status", () => wiseStatus.GET()],
  ["wise/debug", () => wiseDebug.GET(req("/api/wise/debug?profileId=1"))],
];

describe("integrações Revolut/Wise — só o administrador geral", () => {
  it("membro (mesmo na própria conta/empresa) = 403, sem chamar banco e sem gravar credencial", async () => {
    await prisma.credential.create({
      data: { issuer: "revolut", company: "Pixel Ads LLC", token: "refresh-antigo", secrets: JSON.stringify({ clientId: "cli", redirectUri: "http://localhost/api/revolut/callback" }) },
    });
    const before = await prisma.credential.findMany({ orderBy: { id: "asc" } });
    for (const user of [s.users.pixel, s.users.operador, s.users.semAcesso]) {
      loginAs(user);
      for (const [name, call] of integrationCalls()) {
        expect([name, (await call()).status]).toEqual([name, 403]);
      }
    }
    expect(fetched).toEqual([]);
    expect(await prisma.credential.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.setting.count()).toBe(0);
  });

  it("deslogado = 401 (inclusive no callback público do Revolut)", async () => {
    loginAs(null);
    for (const [name, call] of integrationCalls()) {
      expect([name, (await call()).status]).toEqual([name, 401]);
    }
    expect(fetched).toEqual([]);
  });

  it("callback do Revolut com sessão de superadmin segue o fluxo de antes", async () => {
    loginAs(s.users.root);
    expect((await revolutCallback.GET(callbackReq("state=X"))).status).toBe(400); // sem code
    expect((await revolutStatus.GET()).status).toBe(200);
    expect(fetched).toEqual([]);
  });
});

// ───────────────────────────── users/[id] (furo achado na verificação) ─────────────────────────────

describe("PATCH/DELETE /api/users/[id] — admin de um grupo não toma conta de quem é de outro grupo", () => {
  async function seedUsers() {
    const admin = await prisma.user.create({ data: { email: "adm@pixel.com", role: "admin", memberships: { create: { holdingId: s.holdings.pixel.id } } } });
    const shared = await prisma.user.create({
      data: { email: "dupla@teste.com", memberships: { create: [{ holdingId: s.holdings.pixel.id }, { holdingId: s.holdings.outro.id }] } },
    });
    return { admin, shared };
  }

  it("senha, papel, desativar e apagar usuário que também é de outro grupo = 403", async () => {
    const { admin, shared } = await seedUsers();
    loginAs(admin);
    const patch = (json: unknown) => userById.PATCH(req(`/api/users/${shared.id}`, { method: "PATCH", json }), params({ id: shared.id }));
    expect((await patch({ role: "admin" })).status).toBe(403);
    expect((await patch({ isActive: false })).status).toBe(403);
    expect((await userById.DELETE(req(`/api/users/${shared.id}`, { method: "DELETE" }), params({ id: shared.id }))).status).toBe(403);
    const after = await prisma.user.findUnique({ where: { id: shared.id } });
    expect(after).toMatchObject({ role: "member", isActive: true });
  });

  it("vínculos continuam editáveis (preserva os de fora) e usuário só do grupo segue gerenciável", async () => {
    const { admin, shared } = await seedUsers();
    const solo = s.users.pixel;
    loginAs(admin);
    const r = await userById.PATCH(req(`/api/users/${shared.id}`, { method: "PATCH", json: { holdingIds: [s.holdings.pixel.id] } }), params({ id: shared.id }));
    expect(r.status).toBe(200);
    const hs = (await prisma.membership.findMany({ where: { userId: shared.id } })).map((m) => m.holdingId).sort();
    expect(hs).toEqual([s.holdings.pixel.id, s.holdings.outro.id].sort());

    expect((await userById.PATCH(req(`/api/users/${solo.id}`, { method: "PATCH", json: { isActive: true } }), params({ id: solo.id }))).status).toBe(200);

    loginAs(s.users.root);
    expect((await userById.PATCH(req(`/api/users/${shared.id}`, { method: "PATCH", json: { isActive: true } }), params({ id: shared.id }))).status).toBe(200);
  });
});
