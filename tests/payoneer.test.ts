import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as importPayoneer from "@/app/api/transactions/import/payoneer/route";
import * as periodo from "@/app/api/coverage/periodo/route";
import { dataPayoneer, lerPayoneer, valorPayoneer } from "@/lib/payoneer";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Extrato completo do Payoneer (pedido do dono em 2026-11-12: o que tem Transaction ID). Sintético, no MESMO
 * formato do arquivo real: data MM/DD/AAAA + hora UTC, débito POSITIVO, saldo corrido, mais novo primeiro.
 * Saldos encadeados (do mais antigo, USD): 1000 → (+500) 1500 → (−200) 1300 → (−50) 1250.
 */
const CAB = "Transaction Date,Transaction Time,Time Zone,Transaction ID,Description,Credit Amount,Debit Amount,Currency,Transfer Amount,Transfer Amount Currency,Status,Running Balance,Additional Description,Store Name,Source,Target,Reference ID";
const L = {
  pend: "11/09/2026,10:00:00,UTC,9000000005,Card charge,,10.00,USD,,,Pending,1240.00,,FACEBK *ZZZZ9999Z2,USD balance,,",
  meta: "11/08/2026,03:00:16,UTC,9000000004,Card charge,,50.00,USD,,,Completed,1250.00,,FACEBK *AAAA1111B2,USD balance,,",
  pag: "11/07/2026,17:43:31,UTC,9000000003,Payment to Fornecedor Exemplo,,200.00,USD,,,Completed,1300.00,Loan payment,,USD balance,Fornecedor Exemplo,",
  rec: "11/06/2026,10:56:28,UTC,9000000002,Payment from Cliente Exemplo,500.00,,USD,,,Completed,1500.00,Servicos,,Cliente Exemplo,USD balance,",
  base: "11/01/2026,08:00:00,UTC,9000000001,Payment from Cliente Exemplo,1000.00,,USD,,,Completed,1000.00,,,Cliente Exemplo,USD balance,",
  eur: "11/05/2026,12:00:00,UTC,9000000010,Card charge (FACEBK *CCCC3333D2),,78.00,EUR,,,Completed,922.00,,,EUR balance,,",
};
const CSV = [CAB, L.pend, L.meta, L.pag, L.rec, L.eur, L.base].join("\n"); // leitura: USD e EUR juntos
const CSV_USD = [CAB, L.pend, L.meta, L.pag, L.rec, L.base].join("\n"); // o extrato de UMA moeda, como o Payoneer exporta

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
let conta: { id: string };
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "USD", name: "Payoneer Pixel" } });
});

const enviar = (accountId: string, texto = CSV_USD) => {
  const fd = new FormData();
  fd.append("file", new File([texto], "payoneer.csv"));
  fd.append("accountId", accountId);
  return importPayoneer.POST(new Request("http://localhost/x", { method: "POST", body: fd }));
};

describe("leitura do extrato do Payoneer", () => {
  it("data MM/DD/AAAA + hora UTC, valor = crédito − débito (débito positivo), Transaction ID como chave, só Completed", () => {
    expect(dataPayoneer("11/08/2026", "03:00:16", "UTC")?.toISOString()).toBe("2026-11-08T03:00:16.000Z");
    expect(dataPayoneer("11/08/2026", "03:00:16", "EST")?.toISOString()).toBe("2026-11-08T12:00:00.000Z"); // outro fuso: só o dia
    expect(dataPayoneer("02/31/2026", "10:00:00", "UTC")).toBeNull();
    expect(valorPayoneer("18,070.48")).toBe(18070.48);
    const { extrato } = lerPayoneer(CSV);
    expect(extrato!.lancamentos.map((l) => [l.chave, l.valor, l.moeda])).toEqual([
      ["9000000004", -50, "USD"], ["9000000003", -200, "USD"], ["9000000002", 500, "USD"], ["9000000010", -78, "EUR"], ["9000000001", 1000, "USD"],
    ]);
    expect(extrato!.naoConcluidos).toBe(1);
  });

  it("descrição junta Description + Store Name + Additional Description (o FACEBK pode vir só na loja)", () => {
    const [meta, pag] = lerPayoneer(CSV).extrato!.lancamentos;
    expect(meta.descricao).toBe("Card charge — FACEBK *AAAA1111B2");
    expect(pag.descricao).toBe("Payment to Fornecedor Exemplo — Loan payment");
  });

  it("sequência do saldo por moeda: confere; tirar uma linha do meio = quebra", () => {
    expect(lerPayoneer(CSV).extrato!.quebrasDeSaldo).toBe(0);
    expect(lerPayoneer([CAB, L.meta, L.pag, L.base].join("\n")).extrato!.quebrasDeSaldo).toBe(1); // sem o crédito de 500
  });

  it("crédito depositado pelo Payoneer SEM Transaction ID: entra, com chave pelos fatos da linha (instante, valor, moeda, saldo)", () => {
    const deposito = "11/03/2026,09:15:00,UTC,,Credit from Payoneer,300.00,,USD,,,Completed,1300.00,,,,USD balance,";
    const r = lerPayoneer([CAB, deposito, L.base].join("\n")).extrato!; // saldo 1000 → +300 → 1300
    expect([r.invalidos, r.quebrasDeSaldo]).toEqual([0, 0]);
    expect(r.lancamentos.find((l) => l.descricao === "Credit from Payoneer")).toMatchObject({ chave: "sem-id:2026-11-03T09:15:00.000Z:30000:USD:130000", valor: 300 });
    // sozinho no arquivo (o caso do dono: "o arquivo não importa")
    expect(lerPayoneer([CAB, deposito].join("\n")).extrato!.lancamentos).toHaveLength(1);
    // dois créditos iguais no mesmo instante: o saldo depois de cada um os separa; idênticos de tudo → :2
    const outro = "11/03/2026,09:15:00,UTC,,Credit from Payoneer,300.00,,USD,,,Completed,1600.00,,,,USD balance,";
    expect(lerPayoneer([CAB, outro, deposito].join("\n")).extrato!.lancamentos.map((l) => l.chave)).toEqual(["sem-id:2026-11-03T09:15:00.000Z:30000:USD:160000", "sem-id:2026-11-03T09:15:00.000Z:30000:USD:130000"]);
    expect(lerPayoneer([CAB, deposito, deposito].join("\n")).extrato!.lancamentos.map((l) => l.chave)).toEqual(["sem-id:2026-11-03T09:15:00.000Z:30000:USD:130000", "sem-id:2026-11-03T09:15:00.000Z:30000:USD:130000:2"]);
  });

  it("os outros formatos do Payoneer (sem Transaction ID / sem saldo) = erro claro, com as colunas que vieram", () => {
    expect(lerPayoneer("Currency,Payout method,Transaction date,Transaction time,Time zone,Credit amount,Debit amount,Status,Running balance,Description\nEUR,EUR balance,12-31-2025,12:51:50,UTC,0,-1,Completed,1,X").erro)
      .toMatch(/não parece o extrato completo do Payoneer/);
    expect(lerPayoneer('Date,Description,Amount,Currency,Status,Transaction ID\n"07 Nov, 2026",X,"-1.00",USD,Completed,1').erro).toMatch(/faltam as colunas/);
  });
});

describe("POST /api/transactions/import/payoneer", () => {
  afterEach(() => vi.useRealTimers());

  it("importa, marca a cobrança Meta (FACEBK na loja), reimportar não duplica, sugere o mês inteiro e a confirmação cobre", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-05T12:00:00Z") });
    loginAs(admin);
    const r = await (await enviar(conta.id)).json();
    expect(r).toMatchObject({ imported: 4, skipped: 0, naoConcluidos: 1, quebrasDeSaldo: 0, periodo: { de: "2026-11-01", ate: "2026-11-30" } });
    expect((await (await enviar(conta.id)).json())).toMatchObject({ imported: 0, skipped: 4 });
    const meta = await prisma.transaction.findMany({ where: { accountId: conta.id, isMetaCharge: true }, select: { metaRef: true, reference: true } });
    expect(meta).toEqual([{ metaRef: "AAAA1111B2", reference: "payoneer:9000000004" }]);
    expect((await periodo.POST(req("/api/coverage/periodo", { method: "POST", json: { accountId: conta.id, importLogId: r.importLogId, de: "2026-11-01", ate: "2026-11-08" } }))).status).toBe(200);
    expect(await prisma.importCoverage.findMany({ where: { accountId: conta.id }, select: { source: true } })).toEqual([{ source: "arquivo" }]);
  });

  it("uma conta por moeda: extrato com outra moeda é recusado inteiro (nada gravado); o EUR entra na conta EUR", async () => {
    loginAs(admin);
    const r = await enviar(conta.id, CSV); // tem uma linha EUR; a conta é USD
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/lançamentos em EUR e a conta Payoneer Pixel é em USD — conta errada/);
    expect(await prisma.transaction.count({ where: { reference: { startsWith: "payoneer:" } } })).toBe(0);
    const eur = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "EUR", name: "Payoneer Pixel EUR" } });
    const ok = await (await enviar(eur.id, [CAB, L.eur].join("\n"))).json();
    expect(ok).toMatchObject({ imported: 1 });
    expect(await prisma.transaction.findFirst({ where: { accountId: eur.id }, select: { metaRef: true, currency: true } })).toEqual({ metaRef: "CCCC3333D2", currency: "EUR" });
  });

  it("o mesmo extrato não entra em duas contas: Transaction ID que já está em outra conta = 409, nada gravado", async () => {
    loginAs(admin);
    expect((await enviar(conta.id)).status).toBe(200);
    const linkview = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "USD", name: "Payonner" } });
    const r = await enviar(linkview.id);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/já foi importado na conta Payoneer Pixel USD da Pixel Ads LLC/);
    expect(await prisma.transaction.count({ where: { accountId: linkview.id } })).toBe(0);
  });

  it("pagamento entre duas contas Payoneer: o mesmo Transaction ID com débito num lado e crédito no outro entra nos dois (extrato de 1 linha)", async () => {
    loginAs(admin);
    // o recebedor (outra empresa do grupo) já importou o crédito; o pagador tem o débito (com a tarifa) — mesmo ID
    const recebedor = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "USD", name: "Payoneer Recebedor" } });
    const credito = "11/08/2026,03:00:16,UTC,9000000077,Payment from Pagador Exemplo,1998.00,,USD,,,Completed,1998.00,Loan payment,,Pagador Exemplo,USD balance,";
    const debito = "11/08/2026,03:00:16,UTC,9000000077,Payment to Recebedor Exemplo,,2000.00,USD,,,Completed,500.00,Loan payment,,USD balance,Recebedor Exemplo,";
    expect(await (await enviar(recebedor.id, [CAB, credito].join("\n"))).json()).toMatchObject({ imported: 1 });
    const r = await enviar(conta.id, [CAB, debito].join("\n"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ imported: 1 });
    expect(await prisma.transaction.findMany({ where: { reference: "payoneer:9000000077" }, select: { accountId: true, amount: true }, orderBy: { amount: "asc" } }))
      .toEqual([{ accountId: conta.id, amount: -2000 }, { accountId: recebedor.id, amount: 1998 }]);
    // o MESMO lado subido na conta errada continua recusado
    expect((await enviar(recebedor.id, [CAB, debito].join("\n"))).status).toBe(409);
  });

  it("extrato só com o crédito sem Transaction ID importa; reimportar não duplica", async () => {
    loginAs(admin);
    const deposito = "11/03/2026,09:15:00,UTC,,Credit from Payoneer,300.00,,USD,,,Completed,1300.00,,,,USD balance,";
    expect(await (await enviar(conta.id, [CAB, deposito].join("\n"))).json()).toMatchObject({ imported: 1, skipped: 0, invalidos: 0 });
    expect(await (await enviar(conta.id, [CAB, deposito].join("\n"))).json()).toMatchObject({ imported: 0, skipped: 1 });
    expect(await prisma.transaction.findMany({ where: { accountId: conta.id }, select: { amount: true, reference: true } }))
      .toEqual([{ amount: 300, reference: "payoneer:sem-id:2026-11-03T09:15:00.000Z:30000:USD:130000" }]);
  });

  it("conta que não é Payoneer = 400; membro = 403; outro grupo = 404 — nada gravado", async () => {
    loginAs(admin);
    expect((await enviar(s.accounts.pixel.id)).status).toBe(400); // Mercury
    loginAs(s.users.pixel);
    expect((await enviar(conta.id)).status).toBe(403);
    const outro = await prisma.account.create({ data: { companyId: s.companies.outro.id, bank: "Payoneer", currency: "USD", name: "Payoneer Outro" } });
    loginAs(admin);
    expect((await enviar(outro.id)).status).toBe(404);
    expect(await prisma.transaction.count({ where: { reference: { startsWith: "payoneer:" } } })).toBe(0);
  });
});
