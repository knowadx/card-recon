import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as coverage from "@/app/api/coverage/route";
import * as detalhe from "@/app/api/coverage/detalhe/route";
import * as importOfx from "@/app/api/import/ofx/route";
import * as syncMercury from "@/app/api/sync/mercury/route";
import * as syncRevolut from "@/app/api/sync/revolut/route";
import * as accountById from "@/app/api/accounts/[id]/route";
import * as extracoes from "@/app/api/accounts/[id]/extracoes/route";
import { cobertaAte, coberturaDoMes, mesclar } from "@/lib/cobertura";
import { installFakeBanks, mercuryFixture, MERCURY_ACCT, seedBankAccounts } from "./bankFakes";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Controle de importação (decisão do dono em 2026-10-30: "nunca consigo saber exatamente o que já
 * importei. Qual conta, e qual mês" + "a Mercury tem 3 extrações dentro da conta"): cobertura por conta,
 * Control com 2 checkpoints calculados, e 1 conta = 1 extração (Mercury separada por extração).
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
const d = (x: string) => new Date(x);

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("cobertura (regra única)", () => {
  it("mescla trechos que se sobrepõem ou se encostam; buraco fica", () => {
    const m = mesclar([
      { de: d("2026-09-10"), ate: d("2026-10-01") },
      { de: d("2026-08-01"), ate: d("2026-09-10") }, // encosta
      { de: d("2026-10-05"), ate: d("2026-10-16") }, // buraco 01→05/10
    ]);
    expect(m.map((t) => [t.de.toISOString().slice(0, 10), t.ate.toISOString().slice(0, 10)])).toEqual([["2026-08-01", "2026-10-01"], ["2026-10-05", "2026-10-16"]]);
    expect(coberturaDoMes(m, "2026-09")).toEqual({ estado: "completo" });
    expect(coberturaDoMes(m, "2026-10")).toEqual({ estado: "parcial", pedacos: [{ de: d("2026-10-05"), ate: d("2026-10-16") }] });
    expect(coberturaDoMes(m, "2026-07")).toEqual({ estado: "nenhuma" });
    expect(cobertaAte(m)!.toISOString().slice(0, 10)).toBe("2026-10-15"); // fim exclusivo → último dia coberto
  });
});

describe("importações gravam cobertura", () => {
  it("sync Mercury que leu a janela inteira cobre do 'from' até o fim do 'to'; sync que falhou não cobre nada", async () => {
    const acc = await seedBankAccounts(s);
    loginAs(s.users.pixel);
    installFakeBanks({ mercury: { [MERCURY_ACCT]: { ...mercuryFixture(), failPage: 1 } } });
    const post = () => syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId: acc.mercury.id, mercuryAccountId: MERCURY_ACCT, from: "2026-09-01", to: "2026-09-30" } }));
    await post().catch(() => null);
    expect(await prisma.importCoverage.count({ where: { accountId: acc.mercury.id } })).toBe(0);

    installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    expect((await post()).status).toBe(200);
    const cob = await prisma.importCoverage.findMany({ where: { accountId: acc.mercury.id }, select: { from: true, to: true, source: true, userId: true } });
    expect(cob).toEqual([{ from: d("2026-09-01T00:00:00Z"), to: d("2026-10-01T00:00:00Z"), source: "api", userId: s.users.pixel.id }]);
  });

  it("OFX cobre o PERÍODO do arquivo (dias inteiros, fim inclusivo) — mês sem lançamento também fica importado", async () => {
    const xp = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "XP", currency: "BRL", name: "XP Pixel" } });
    loginAs(admin);
    const res = await importOfx.POST(new Request(`http://localhost/api/import/ofx?accountId=${xp.id}`, {
      method: "POST", headers: { "x-filename": encodeURIComponent("xp_ago_set.ofx") }, body: ofx("20260801", "20260930", [["20260905", "-10.00", "f-1"]]),
    }));
    expect(res.status).toBe(200);
    const cob = await prisma.importCoverage.findFirstOrThrow({ where: { accountId: xp.id }, include: { importLog: true } });
    expect([cob.from, cob.to, cob.source, cob.importLog?.filename]).toEqual([d("2026-08-01T00:00:00Z"), d("2026-10-01T00:00:00Z"), "ofx", "xp_ago_set.ofx"]);
  });
});

/** OFX mínimo (formato da XP) com período e lançamentos escolhidos. */
function ofx(ini: string, fim: string, lancs: Array<[string, string, string]>) {
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>348</BANKID><BRANCHID>0001</BRANCHID><ACCTID>777</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>${ini}</DTSTART><DTEND>${fim}</DTEND>
${lancs.map(([dt, v, id]) => `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>${dt}</DTPOSTED><TRNAMT>${v}</TRNAMT><FITID>${id}</FITID><MEMO>Pagamento ${id}</MEMO></STMTTRN>`).join("\n")}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

describe("/api/coverage — dois checkpoints por conta e mês", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T12:00:00Z") }); });

  it("importação = cobertura (não contagem): completo sem lançamento, até o dia, sem comprovação, faltando, antes; categorização separada", async () => {
    const conta = s.accounts.pixel.id; // tem a transação de 01/10 do seed (split com operação, SEM categoria)
    const cat = await prisma.category.create({ data: { type: "MANAGERIAL", name: "Custos" } });
    await prisma.transaction.create({ data: { accountId: conta, date: d("2026-06-10"), description: "antiga", amount: -5, currency: "USD", reference: "px-jun", splits: { create: { amount: -5, managerialCategoryId: cat.id } } } });
    await prisma.importCoverage.create({ data: { accountId: conta, from: d("2026-08-01T00:00:00Z"), to: d("2026-10-16T10:00:00Z"), source: "api", userId: admin.id } });
    const xpVazia = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "XP", currency: "BRL", name: "XP esquecida" } });

    loginAs(admin);
    const { status, body } = await json(await coverage.GET());
    expect(status).toBe(200);
    const px = body.accounts.find((a: { id: string }) => a.id === conta);
    const est = (m: string) => [px.meses[m].imp, px.meses[m].total, px.meses[m].semCategoria];
    expect(est("2026-05")).toEqual(["antes", 0, 0]);
    expect(est("2026-06")).toEqual(["sem_comprovacao", 1, 0]); // tem lançamento, nenhuma importação registrada cobre
    expect(est("2026-07")).toEqual(["faltando", 0, 0]);
    expect(est("2026-08")).toEqual(["completo", 0, 0]); // importado, sem movimento
    expect(est("2026-09")).toEqual(["completo", 0, 0]);
    expect(est("2026-10")).toEqual(["parcial", 1, 1]); // split só com operação NÃO é categoria
    expect(px.meses["2026-10"].pedacos).toEqual([{ de: "2026-10-01T00:00:00.000Z", ate: "2026-10-16T10:00:00.000Z" }]);
    expect(px).toMatchObject({ fonte: "api", nuncaImportada: false, cobertaAte: "2026-10-16T09:59:59.999Z", ultimaImportacao: { fonte: "api", quem: "Admin Pixel" } });
    expect(body.accounts.find((a: { id: string }) => a.id === xpVazia.id)).toMatchObject({ nuncaImportada: true, fonte: null });
  });

  it("detalhe da célula: as importações que cobrem o mês; outro grupo = 404; membro = 403", async () => {
    await prisma.importCoverage.create({ data: { accountId: s.accounts.pixel.id, from: d("2026-08-01T00:00:00Z"), to: d("2026-10-16T10:00:00Z"), source: "api", userId: admin.id } });
    const get = (accountId: string, mes: string) => detalhe.GET(req(`/api/coverage/detalhe?accountId=${accountId}&mes=${mes}`));
    loginAs(admin);
    const { body } = await json(await get(s.accounts.pixel.id, "2026-10"));
    expect(body.importacoes).toEqual([expect.objectContaining({ fonte: "api", de: "2026-08-01T00:00:00.000Z", ate: "2026-10-16T10:00:00.000Z", quem: "Admin Pixel" })]);
    expect((await json(await get(s.accounts.pixel.id, "2026-07"))).body.importacoes).toEqual([]);
    expect((await get(s.accounts.outro.id, "2026-10")).status).toBe(404);
    loginAs(s.users.pixel);
    expect((await get(s.accounts.pixel.id, "2026-10")).status).toBe(403);
  });
});

describe("1 conta = 1 extração", () => {
  const syncM = (accountId: string, mercuryAccountId: string) =>
    syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId, mercuryAccountId, from: "2026-09-01", to: "2026-09-30" } }));

  it("Mercury: puxar OUTRA extração numa conta com dados = 409 sem chamar a Mercury; conta vazia pode; extração de outra conta = 409", async () => {
    const acc = await seedBankAccounts(s);
    await prisma.account.update({ where: { id: acc.mercury.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: "merc-outra" }) } });
    loginAs(s.users.pixel);
    const fake = installFakeBanks({ mercury: { [MERCURY_ACCT]: mercuryFixture() } });
    const r = await json(await syncM(acc.mercury.id, MERCURY_ACCT));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/misturaria as duas/);
    expect(fake.calls).toEqual([]);

    const vazia = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Mercury", currency: "USD", name: "Mercury nova", apiToken: "tok-merc-pixel", syncConfig: JSON.stringify({ mercuryAccountId: "merc-x" }) } });
    expect((await syncM(vazia.id, MERCURY_ACCT)).status).toBe(200);
    expect(JSON.parse((await prisma.account.findUniqueOrThrow({ where: { id: vazia.id } })).syncConfig!).mercuryAccountId).toBe(MERCURY_ACCT);

    const terceira = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Mercury", currency: "USD", name: "Mercury 3", apiToken: "tok-merc-pixel" } });
    const dup = await json(await syncM(terceira.id, MERCURY_ACCT));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/já é puxada na conta Mercury nova/);
  });

  it("Revolut 'todas as contas' com dados não vira uma conta só; trocar a extração pelo PATCH também é recusado", async () => {
    const acc = await seedBankAccounts(s);
    await prisma.account.update({ where: { id: acc.revolut.id }, data: { syncConfig: JSON.stringify({ revolutAccountId: null }) } });
    await prisma.transaction.create({ data: { accountId: acc.revolut.id, date: d("2026-10-01"), description: "x", amount: -1, currency: "EUR", reference: "revolut:a:b" } });
    loginAs(s.users.pixel);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("não devia chamar o banco"); }));
    const r = await json(await syncRevolut.POST(req("/api/sync/revolut", { method: "POST", json: { accountId: acc.revolut.id, revolutAccountId: "rev-eur" } })));
    expect(r.status).toBe(409);

    loginAs(admin);
    const patch = (id: string, cfg: Record<string, unknown>) => accountById.PATCH(req("/x", { method: "PATCH", json: { syncConfig: cfg } }), params({ id }));
    expect((await patch(acc.revolut.id, { revolutAccountId: "rev-eur" })).status).toBe(409);
    expect((await patch(acc.wise.id, { wiseProfileId: "p-1" })).status).toBe(200); // 1ª extração da conta: pode
  });
});

describe("Separar extrações (Mercury)", () => {
  const MERC = "https://api.mercury.com/api/v1";
  const doBanco: Record<string, string[]> = { chk: ["t-chk-1", "t-chk-2"], sav: ["t-sav-1"], cred: ["t-cred-1", "t-cred-2"] };
  function mercuryCom3Extracoes() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.href === `${MERC}/accounts`) return Response.json({ accounts: [{ id: "chk", name: "Mercury Checking ••1111", kind: "checking" }, { id: "sav", name: "Mercury Savings ••2222", kind: "savings" }] });
      if (u.href === `${MERC}/credit`) return Response.json({ accounts: [{ id: "cred" }] });
      if (u.pathname === "/api/v1/transactions") return Response.json({ transactions: (doBanco[u.searchParams.get("accountId")!] ?? []).map((id) => ({ id })) });
      return new Response("inesperado", { status: 404 });
    }));
  }

  it("plano → separa: a conta fica com a extração configurada; cada outra ganha conta própria com os lançamentos dela; o que não achou fica", async () => {
    const conta = s.accounts.pixel.id; // já tem px-1 (não existe em extração nenhuma)
    await prisma.account.update({ where: { id: conta }, data: { apiToken: "tok-merc", syncConfig: JSON.stringify({ mercuryAccountId: "chk", mercuryEntity: "activeview" }) } });
    for (const ref of Object.values(doBanco).flat()) {
      await prisma.transaction.create({ data: { accountId: conta, date: d("2026-09-10"), description: ref, amount: -1, currency: "USD", reference: ref } });
    }
    mercuryCom3Extracoes();
    loginAs(admin);

    const plano = await json(await extracoes.GET(req("/x"), params({ id: conta })));
    expect(plano.status).toBe(200);
    expect(plano.body.extracoes.map((e: { id: string; lancamentos: number; fica: boolean }) => [e.id, e.lancamentos, e.fica])).toEqual([["chk", 2, true], ["sav", 1, false], ["cred", 2, false]]);
    expect(plano.body.semExtracao).toBe(1);
    expect(await prisma.account.count({ where: { bank: "Mercury" } })).toBe(1); // plano não muda nada

    const feito = await json(await extracoes.POST(req("/x", { method: "POST" }), params({ id: conta })));
    expect(feito.status).toBe(200);
    expect(feito.body.criadas.map((c: { nome: string; lancamentos: number }) => [c.nome, c.lancamentos])).toEqual([
      ["Mercury Pixel · Mercury Savings ••2222", 1],
      ["Mercury Pixel · Mercury Credit", 2],
    ]);
    const refsDe = async (id: string) => (await prisma.transaction.findMany({ where: { accountId: id }, select: { reference: true }, orderBy: { reference: "asc" } })).map((t) => t.reference);
    expect(await refsDe(conta)).toEqual(["px-1", "t-chk-1", "t-chk-2"]);
    const novas = await prisma.account.findMany({ where: { id: { not: conta }, bank: "Mercury" }, orderBy: { name: "asc" } });
    expect(novas.map((a) => [a.name, a.apiToken, JSON.parse(a.syncConfig!).mercuryAccountId])).toEqual([
      ["Mercury Pixel · Mercury Credit", "tok-merc", "cred"],
      ["Mercury Pixel · Mercury Savings ••2222", "tok-merc", "sav"],
    ]);
    expect(await refsDe(novas[0].id)).toEqual(["t-cred-1", "t-cred-2"]);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: conta } })).name).toBe("Mercury Pixel · Mercury Checking ••1111");

    // e daqui pra frente a conta não aceita outra extração
    const r = await json(await syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId: conta, mercuryAccountId: "sav" } })));
    expect(r.status).toBe(409);
  });

  it("membro = 403; admin de outro grupo = 404; conta que não é Mercury = 400 — sem mudar nada", async () => {
    mercuryCom3Extracoes();
    loginAs(s.users.pixel);
    expect((await extracoes.POST(req("/x", { method: "POST" }), params({ id: s.accounts.pixel.id }))).status).toBe(403);
    const adminOutro = await prisma.user.create({ data: { email: "adm-ot@teste.com", role: "admin" } });
    await prisma.membership.create({ data: { userId: adminOutro.id, holdingId: s.holdings.outro.id } });
    loginAs(adminOutro);
    expect((await extracoes.POST(req("/x", { method: "POST" }), params({ id: s.accounts.pixel.id }))).status).toBe(404);
    expect((await extracoes.GET(req("/x"), params({ id: s.accounts.outro.id }))).status).toBe(400); // Wise
    expect(await prisma.account.count({ where: { bank: "Mercury" } })).toBe(1);
  });
});
