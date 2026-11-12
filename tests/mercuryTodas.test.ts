import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as syncMercury from "@/app/api/sync/mercury/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Mercury "todas" (decisão do dono em 2026-11-12: "não deveria ter que fazer três cadastros, a Mercury já
 * poderia sincronizar tudo"): uma conta daqui puxa todas as sub-contas da chave (checking, savings, cartão).
 * Cobertura só se TODAS foram lidas até o fim; exige o token da própria conta; ampliar pra todas pode, estreitar não.
 */
const MERC = "https://api.mercury.com/api/v1";
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let conta: string;
let falhar: string | null;

const tx = (id: string, dia: string, valor: number) => ({ id, amount: valor, postedAt: `${dia}T12:00:00Z`, createdAt: `${dia}T12:00:00Z`, status: "sent", counterpartyName: `Contraparte ${id}`, bankDescription: null, merchantName: null, note: null, externalMemo: null, kind: "x" });
const NO_BANCO: Record<string, unknown[]> = {
  chk: [tx("t-chk-1", "2026-09-02", -10), tx("t-chk-2", "2026-09-20", 500)],
  sav: [tx("t-sav-1", "2026-09-05", 1000)],
  cred: [tx("t-cred-1", "2026-09-10", -42)],
};

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  conta = s.accounts.pixel.id;
  await prisma.account.update({ where: { id: conta }, data: { apiToken: "tok-merc" } });
  falhar = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.href === `${MERC}/accounts`) return Response.json({ accounts: [{ id: "chk", name: "Mercury Checking ••8237" }, { id: "sav", name: "Mercury Savings ••4829" }] });
    if (u.href === `${MERC}/credit`) return Response.json({ accounts: [{ id: "cred" }] });
    const cartoes = u.pathname.match(/^\/api\/v1\/account\/([^/]+)\/cards$/);
    if (cartoes) return Response.json({ cards: [] });
    if (u.pathname === "/api/v1/transactions") {
      const id = u.searchParams.get("accountId")!;
      if (id === falhar) return new Response("boom", { status: 500 });
      return Response.json({ transactions: NO_BANCO[id] ?? [] });
    }
    return new Response("inesperado", { status: 404 });
  }));
  loginAs(s.users.pixel);
});
afterEach(() => vi.unstubAllGlobals());

const sync = (mercuryAccountId: string, accountId = conta) =>
  syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId, mercuryAccountId, from: "2026-09-01", to: "2026-09-30" } }));
const refs = async () => (await prisma.transaction.findMany({ where: { accountId: conta, reference: { startsWith: "t-" } }, select: { reference: true }, orderBy: { reference: "asc" } })).map((t) => t.reference);
const cobertura = () => prisma.importCoverage.findMany({ where: { accountId: conta }, select: { from: true, to: true } });

describe("Mercury: todas as sub-contas numa conta só", () => {
  it("lê checking, savings e cartão, grava os lançamentos das três, lembra 'todas' e cobre o período", async () => {
    const r = await sync("todas");
    expect(r.status).toBe(200);
    expect(await refs()).toEqual(["t-chk-1", "t-chk-2", "t-cred-1", "t-sav-1"]);
    expect(JSON.parse((await prisma.account.findUniqueOrThrow({ where: { id: conta } })).syncConfig!)).toMatchObject({ mercuryAccountId: "todas" });
    expect(await cobertura()).toEqual([{ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") }]);
  });

  it("uma sub-conta que falha derruba o sync: nada gravado e nenhuma cobertura", async () => {
    falhar = "sav";
    await expect(sync("todas")).rejects.toThrow(/Mercury API error: 500/);
    expect(await refs()).toEqual([]);
    expect(await cobertura()).toEqual([]);
  });

  it("sem token próprio da conta (só chave global) = 400, sem chamar a Mercury", async () => {
    await prisma.account.update({ where: { id: conta }, data: { apiToken: null } });
    loginAs(s.users.root); // superadmin poderia cair na chave global — e é justamente o que "todas" não aceita
    vi.stubEnv("MERCURY_API_KEY", "chave-global");
    const r = await sync("todas");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/token/);
    vi.unstubAllEnvs();
  });

  it("conta que puxava UMA sub-conta pode ampliar pra todas; quem puxa todas não volta pra uma só", async () => {
    expect((await sync("chk")).status).toBe(200);
    expect(await refs()).toEqual(["t-chk-1", "t-chk-2"]);
    expect((await sync("todas")).status).toBe(200);
    expect(await refs()).toEqual(["t-chk-1", "t-chk-2", "t-cred-1", "t-sav-1"]);
    const volta = await sync("sav");
    expect(volta.status).toBe(409);
    expect((await volta.json()).error).toMatch(/misturaria/);
  });

  it("'todas' numa conta e outra conta Mercury da mesma empresa puxando uma sub-conta = 409 (duplicaria)", async () => {
    await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Mercury", currency: "USD", name: "Mercury cartão", apiToken: "tok-merc", syncConfig: JSON.stringify({ mercuryAccountId: "cred" }) } });
    const r = await sync("todas");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/já é puxada na conta Mercury cartão/);
  });
});
