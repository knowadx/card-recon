import { beforeEach, describe, expect, it } from "vitest";
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
const CSV = [CAB, L.pend, L.meta, L.pag, L.rec, L.eur, L.base].join("\n");

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

const enviar = (accountId: string, texto = CSV) => {
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

  it("os outros formatos do Payoneer (sem Transaction ID / sem saldo) = erro claro, com as colunas que vieram", () => {
    expect(lerPayoneer("Currency,Payout method,Transaction date,Transaction time,Time zone,Credit amount,Debit amount,Status,Running balance,Description\nEUR,EUR balance,12-31-2025,12:51:50,UTC,0,-1,Completed,1,X").erro)
      .toMatch(/não parece o extrato completo do Payoneer/);
    expect(lerPayoneer('Date,Description,Amount,Currency,Status,Transaction ID\n"07 Nov, 2026",X,"-1.00",USD,Completed,1').erro).toMatch(/faltam as colunas/);
  });
});

describe("POST /api/transactions/import/payoneer", () => {
  it("importa, marca a cobrança Meta (FACEBK na loja ou na descrição), reimportar não duplica, sugere o período e a confirmação cobre", async () => {
    loginAs(admin);
    const r = await (await enviar(conta.id)).json();
    expect(r).toMatchObject({ imported: 5, skipped: 0, naoConcluidos: 1, quebrasDeSaldo: 0, periodo: { de: "2026-11-01", ate: "2026-11-08" } });
    expect((await (await enviar(conta.id)).json())).toMatchObject({ imported: 0, skipped: 5 });
    const meta = await prisma.transaction.findMany({ where: { accountId: conta.id, isMetaCharge: true }, select: { metaRef: true, reference: true }, orderBy: { metaRef: "asc" } });
    expect(meta).toEqual([{ metaRef: "AAAA1111B2", reference: "payoneer:9000000004" }, { metaRef: "CCCC3333D2", reference: "payoneer:9000000010" }]);
    expect((await periodo.POST(req("/api/coverage/periodo", { method: "POST", json: { accountId: conta.id, importLogId: r.importLogId, de: "2026-11-01", ate: "2026-11-08" } }))).status).toBe(200);
    expect(await prisma.importCoverage.findMany({ where: { accountId: conta.id }, select: { source: true } })).toEqual([{ source: "arquivo" }]);
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
