import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as importPayoneer from "@/app/api/transactions/import/payoneer/route";
import * as periodo from "@/app/api/coverage/periodo/route";
import { dataPayoneer, lerPayoneer, valorPayoneer } from "@/lib/payoneer";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * CSV do Payoneer (pedido do dono em 2026-11-12). Sintético, no MESMO formato do arquivo real da Pixel Ads:
 * data "DD Mon, AAAA" entre aspas, valor "-18,070.48", Transaction ID com tab e espaços no fim.
 */
const CSV = [
  "Date,Description,Amount,Currency,Status,Transaction ID  ",
  '"07 Nov, 2026",Payment to Fornecedor Exemplo,"-18,070.48",USD,Completed,1000000001\t   ',
  '"06 Nov, 2026",Payment from Cliente Exemplo (EMPRESA EXEMPLO),"28,383.30",USD,Completed,1000000002\t   ',
  '"05 Nov, 2026",Payment to Outro Fornecedor,"-500.00",USD,Pending,1000000003\t   ',
  '"30 Jan, 2026",Payment from Cliente Exemplo,"68,050.77",USD,Completed,1000000004',
].join("\n");

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
  fd.append("file", new File([texto], "report.csv"));
  fd.append("accountId", accountId);
  return importPayoneer.POST(new Request("http://localhost/x", { method: "POST", body: fd }));
};

describe("leitura do CSV do Payoneer", () => {
  it("data 'DD Mon, AAAA', valor com vírgula de milhar e sinal, ID sem o tab; só Completed", () => {
    expect(dataPayoneer("07 Nov, 2026")?.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(dataPayoneer("Nov 7, 2026")?.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(dataPayoneer("31 Fev, 2026")).toBeNull();
    expect(valorPayoneer("-18,070.48")).toBe(-18070.48);
    const { extrato } = lerPayoneer(CSV);
    expect(extrato!.lancamentos.map((l) => [l.id, l.valor, l.moeda, l.data.toISOString().slice(0, 10)])).toEqual([
      ["1000000001", -18070.48, "USD", "2026-11-07"],
      ["1000000002", 28383.3, "USD", "2026-11-06"],
      ["1000000004", 68050.77, "USD", "2026-01-30"],
    ]);
    expect(extrato!.naoConcluidos).toBe(1);
  });

  it("arquivo de outro formato = erro claro, com as colunas que vieram", () => {
    expect(lerPayoneer("Data;Historico;Valor\n01/01/2026;x;1").erro).toMatch(/não parece o CSV do Payoneer/);
  });
});

describe("POST /api/transactions/import/payoneer", () => {
  it("importa os concluídos, reimportar não duplica, sugere o período e a confirmação cobre", async () => {
    loginAs(admin);
    const r = await (await enviar(conta.id)).json();
    expect(r).toMatchObject({ imported: 3, skipped: 0, naoConcluidos: 1, periodo: { de: "2026-01-30", ate: "2026-11-07" } });
    const r2 = await (await enviar(conta.id)).json();
    expect(r2).toMatchObject({ imported: 0, skipped: 3 });
    const linhas = await prisma.transaction.findMany({ where: { accountId: conta.id }, select: { reference: true, amount: true, currency: true }, orderBy: { reference: "asc" } });
    expect(linhas).toEqual([
      { reference: "payoneer:1000000001", amount: -18070.48, currency: "USD" },
      { reference: "payoneer:1000000002", amount: 28383.3, currency: "USD" },
      { reference: "payoneer:1000000004", amount: 68050.77, currency: "USD" },
    ]);
    expect((await periodo.POST(req("/api/coverage/periodo", { method: "POST", json: { accountId: conta.id, importLogId: r.importLogId, de: "2026-01-01", ate: "2026-11-07" } }))).status).toBe(200);
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
