import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import * as importHusky from "@/app/api/transactions/import/husky/route";
import { lerHuskyCsv, mesmaEmpresa } from "@/lib/husky";
import { loginAs, resetRequest, seedTwoGroups } from "./helpers";

/**
 * CSV da Husky (dono, 2026-11-13: "a Husky agora faz exportação de CSV"). Sintético, no MESMO layout do arquivo dele:
 * 2 linhas de cabeçalho (Payer Name, Account Type), colunas, instante UTC com milissegundos, amount na moeda da conta
 * (USD) e currency/payoutAmount = o que o beneficiário recebeu (3000 BRL ÷ 5.2249 = 574.17).
 */
const COLUNAS = "date,event,currency,amount,fullname,document,email,feeBearer,feeRate,marketRate,payoutAmount,trackingCode";
const L = {
  um: "2026-10-02T02:42:05.638Z,DEBIT,BRL,-574.17,11.111.111 FORNECEDOR UM,11.111.111/0001-11,um@exemplo.com,payer,0,5.2249,3000.00,",
  dois: "2026-10-02T02:42:02.776Z,DEBIT,BRL,-574.17,22.222.222 FORNECEDOR DOIS,22.222.222/0001-22,dois@exemplo.com,payer,0,5.2249,3000.00,",
  tres: "2026-10-02T02:41:59.658Z,DEBIT,BRL,-956.96,33.333.333 FORNECEDOR TRES,33.333.333/0001-33,tres@exemplo.com,payer,0,5.2249,5000.00,",
  credito: "2026-10-15T10:00:00.000Z,CREDIT,USD,2000.00,Pixel Ads LLC,,,,0,1,2000.00,",
};
const csv = (pagador = "Pixel Ads LLC", ...linhas: string[]) =>
  [`Payer Name,${pagador},,`, "Account Type,Payer,,", COLUNAS, ...(linhas.length ? linhas : [L.um, L.dois, L.tres, L.credito])].join("\n");

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
let conta: { id: string };
beforeEach(async () => {
  resetRequest();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Husky", currency: "USD", name: "Husky" } });
});
afterEach(() => vi.useRealTimers());

const enviar = (arquivo: Blob, nome = "statement.csv", accountId = conta.id) => {
  const fd = new FormData();
  fd.append("file", new File([arquivo], nome));
  fd.append("accountId", accountId);
  return importHusky.POST(new Request("http://localhost/x", { method: "POST", body: fd }));
};

describe("leitura do CSV da Husky", () => {
  it("cabeçalho de quem paga, instante exato, valor na moeda da conta, descrição sem e-mail nem documento", () => {
    const r = lerHuskyCsv(csv(), "USD");
    if ("erro" in r) throw new Error(r.erro);
    expect(r.pagador).toBe("Pixel Ads LLC");
    expect(r.lancamentos.map((l) => [l.data.toISOString(), l.valor, l.descricao])).toEqual([
      ["2026-10-02T02:42:05.638Z", -574.17, "DEBIT · 11.111.111 FORNECEDOR UM · 3000.00 BRL"],
      ["2026-10-02T02:42:02.776Z", -574.17, "DEBIT · 22.222.222 FORNECEDOR DOIS · 3000.00 BRL"],
      ["2026-10-02T02:41:59.658Z", -956.96, "DEBIT · 33.333.333 FORNECEDOR TRES · 5000.00 BRL"],
      ["2026-10-15T10:00:00.000Z", 2000, "CREDIT · Pixel Ads LLC"], // mesma moeda da conta: sem repetir o valor
    ]);
    expect(r.lancamentos[0].chave).toBe("csv:2026-10-02T02:42:05.638Z:-57417");
    expect(lerHuskyCsv("qualquer,coisa\n1,2", "USD")).toEqual({ erro: expect.stringMatching(/não parece o CSV da Husky/) });
    expect(lerHuskyCsv([`Payer Name,Pixel Ads LLC`, COLUNAS].join("\n"), "USD")).toEqual({ erro: expect.stringMatching(/não tem nenhum lançamento/) });
  });

  it("empresa do arquivo × empresa da conta: maiúsculas, acento e pontuação não importam", () => {
    expect(mesmaEmpresa("Pixel Ads LLC", "PIXEL ADS LLC")).toBe(true);
    expect(mesmaEmpresa("LinkView OU", "LINKVIEW OÜ")).toBe(true);
    expect(mesmaEmpresa("Pixel Ads LLC", "LINKVIEW OÜ")).toBe(false);
    expect(mesmaEmpresa(null, "LINKVIEW OÜ")).toBe(true); // arquivo sem o nome: não dá pra dizer
  });
});

describe("POST /api/transactions/import/husky com CSV", () => {
  it("importa, sugere o mês inteiro, reimportar não duplica; e-mail do beneficiário não é gravado", async () => {
    loginAs(admin);
    const r = await enviar(new Blob([csv()]));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ imported: 4, skipped: 0, invalidos: 0, formato: "csv", periodo: { de: "2026-10-01", ate: "2026-10-31" } });
    expect(await (await enviar(new Blob([csv()]))).json()).toMatchObject({ imported: 0, skipped: 4 });
    const gravados = await prisma.transaction.findMany({ where: { accountId: conta.id }, select: { reference: true, description: true, currency: true } });
    expect(gravados.every((t) => t.reference!.startsWith("husky:csv:") && t.currency === "USD" && !t.description.includes("@"))).toBe(true);
  });

  it("dois pagamentos idênticos no mesmo instante são dois lançamentos", async () => {
    loginAs(admin);
    expect(await (await enviar(new Blob([csv("Pixel Ads LLC", L.um, L.um)]))).json()).toMatchObject({ imported: 2 });
    expect((await prisma.transaction.findMany({ where: { accountId: conta.id }, select: { reference: true }, orderBy: { reference: "asc" } })).map((t) => t.reference))
      .toEqual(["husky:csv:2026-10-02T02:42:05.638Z:-57417", "husky:csv:2026-10-02T02:42:05.638Z:-57417#2"]);
  });

  it("extrato de outra empresa = 400, nada gravado", async () => {
    loginAs(admin);
    const r = await enviar(new Blob([csv("Outra Empresa LTDA")]));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("esse extrato é de Outra Empresa LTDA e a conta Husky é da Pixel Ads LLC — conta errada?");
    expect(await prisma.transaction.count({ where: { accountId: conta.id } })).toBe(0);
  });

  it("o mesmo período não entra pelos dois formatos: CSV onde a planilha já importou = 409; planilha onde o CSV já importou = 409", async () => {
    loginAs(admin);
    await prisma.transaction.create({ data: { accountId: conta.id, date: new Date("2026-10-02T12:00:00Z"), description: "Payout 1 · Fornecedor", amount: -574.17, currency: "USD", reference: "husky:2026-10-02:-574.17:Payout 1 · Fornecedor" } });
    const r = await enviar(new Blob([csv()]));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/já tem 1 lançamento\(s\) importado\(s\) pela planilha \(XLS\) entre 02\/10\/2026 e 02\/10\/2026/);
    expect(await prisma.transaction.count({ where: { accountId: conta.id } })).toBe(1);
    // CSV de um período sem planilha entra
    expect((await enviar(new Blob([csv("Pixel Ads LLC", "2026-10-20T09:00:00.000Z,DEBIT,BRL,-10.00,44.444.444 FORNECEDOR,,,payer,0,5.2,52.00,")]))).status).toBe(200);
    // e a planilha não entra mais em cima do CSV
    const planilha = XLSX.utils.aoa_to_sheet([["Date", "Event", "Payer", "Beneficiary", "Amount"], ["Start date", "Initial balance", "", "", ""], ["2026-10-20", "Payout 2", "", "Fornecedor", "-10"]]);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Extrato");
    const xls = await enviar(new Blob([XLSX.write(livro, { type: "array", bookType: "xlsx" }) as ArrayBuffer]), "husky.xlsx");
    expect(xls.status).toBe(409);
    expect((await xls.json()).error).toMatch(/importado\(s\) pelo CSV entre 20\/10\/2026/);
  });
});
