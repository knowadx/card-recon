import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import * as coverage from "@/app/api/coverage/route";
import * as periodo from "@/app/api/coverage/periodo/route";
import * as detalhe from "@/app/api/coverage/detalhe/route";
import * as semMovimento from "@/app/api/coverage/sem-movimento/route";
import * as importCsv from "@/app/api/transactions/import/route";
import * as importHusky from "@/app/api/transactions/import/husky/route";
import * as importDolafy from "@/app/api/transactions/import/dolafy/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Importação por conta no Controle (decisão do dono em 2026-11-12): arquivo SEM período dentro (Husky,
 * Dolafy, CSV genérico) importa, grava o histórico e devolve o período sugerido; só a confirmação do
 * período (POST /api/coverage/periodo) faz o mês contar como importado. Fechamentos desde jan/2025.
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
afterEach(() => vi.useRealTimers());

const enviar = (rota: { POST: (r: Request) => Promise<Response> }, accountId: string, arquivo: Blob, nome: string) => {
  const fd = new FormData();
  fd.append("file", new File([arquivo], nome));
  fd.append("accountId", accountId);
  return rota.POST(new Request("http://localhost/x", { method: "POST", body: fd }));
};
const confirmar = (json: Record<string, unknown>) => periodo.POST(req("/api/coverage/periodo", { method: "POST", json }));
const cobertura = (accountId: string) => prisma.importCoverage.findMany({ where: { accountId }, select: { from: true, to: true, source: true } });

describe("arquivo sem período: importa, sugere o período e só a confirmação cobre", () => {
  it("CSV genérico: sugere os meses inteiros das datas lidas e grava o histórico; sem confirmar, nenhuma cobertura", async () => {
    const conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Outro", currency: "USD", name: "Banco qualquer" } });
    loginAs(admin);
    const csv = "date,description,amount\n2026-03-05,Fornecedor,-10\n2026-03-28,Cliente,50\n2026-03-12,Taxa,-1\n";
    const r = await enviar(importCsv, conta.id, new Blob([csv]), "marco.csv");
    const j = await r.json();
    expect(r.status).toBe(200);
    // dia sem movimento não aparece no arquivo: a sugestão é o mês todo, não 05 a 28 (dono, 2026-11-13)
    expect(j).toMatchObject({ imported: 3, periodo: { de: "2026-03-01", ate: "2026-03-31" } });
    const log = await prisma.importLog.findUniqueOrThrow({ where: { id: j.importLogId } });
    expect([log.kind, log.filename, JSON.parse(log.summary).accountId]).toEqual(["csv", "marco.csv", conta.id]);
    expect([log.periodFrom, log.periodTo]).toEqual([d("2026-03-05T00:00:00Z"), d("2026-03-28T00:00:00Z")]); // o que o arquivo tem
    expect(await cobertura(conta.id)).toEqual([]);

    // a pessoa confirma o mês inteiro (o arquivo é o extrato de março)
    expect((await confirmar({ accountId: conta.id, importLogId: j.importLogId, de: "2026-03-01", ate: "2026-03-31" })).status).toBe(200);
    expect(await cobertura(conta.id)).toEqual([{ from: d("2026-03-01T00:00:00Z"), to: d("2026-04-01T00:00:00Z"), source: "arquivo" }]);
  });

  it("Dolafy e Husky também devolvem o período sugerido", async () => {
    const dolafy = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Dolafy", currency: "USD", name: "Dolafy" } });
    const husky = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Husky", currency: "USD", name: "Husky" } });
    loginAs(admin);
    const csvDolafy = "Date,Description,Amount,Status\n\"Jun 2, 2026, 09:38\",Pagamento,-20,Completed\n\"Jun 20, 2026\",Taxa,-2,Completed\n";
    const rd = await (await enviar(importDolafy, dolafy.id, new Blob([csvDolafy]), "dolafy.csv")).json();
    expect(rd).toMatchObject({ imported: 2, periodo: { de: "2026-06-01", ate: "2026-06-30" } });

    const planilha = XLSX.utils.aoa_to_sheet([["Date", "Event", "Payer", "Beneficiary", "Amount"], ["Start date", "Initial balance", "", "", ""], ["2026-07-03", "Pagamento", "", "Fornecedor", "-15"], ["2026-07-30", "Recebimento", "Cliente", "", "40"]]);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Extrato");
    const xls = XLSX.write(livro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const rh = await (await enviar(importHusky, husky.id, new Blob([xls]), "husky.xlsx")).json();
    expect(rh).toMatchObject({ imported: 2, periodo: { de: "2026-07-01", ate: "2026-07-31" } });
  });

  it("arquivo que chega no mês atual: a sugestão para em hoje", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
    const conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Outro", currency: "USD", name: "Banco qualquer" } });
    loginAs(admin);
    const csv = "date,description,amount\n2026-10-20,Fornecedor,-10\n2026-11-07,Cliente,50\n";
    const j = await (await enviar(importCsv, conta.id, new Blob([csv]), "out-nov.csv")).json();
    expect(j.periodo).toEqual({ de: "2026-10-01", ate: "2026-11-13" });
  });

  it("confirmar recusa: arquivo de outra conta, período invertido ou no futuro; conta de outro grupo = 404", async () => {
    const a = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Outro", currency: "USD", name: "A" } });
    const b = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Outro", currency: "USD", name: "B" } });
    loginAs(admin);
    const j = await (await enviar(importCsv, a.id, new Blob(["date,description,amount\n2026-03-05,X,-1\n"]), "a.csv")).json();
    expect((await confirmar({ accountId: b.id, importLogId: j.importLogId, de: "2026-03-01", ate: "2026-03-31" })).status).toBe(400); // arquivo é da A
    expect((await confirmar({ accountId: a.id, importLogId: j.importLogId, de: "2026-03-31", ate: "2026-03-01" })).status).toBe(400);
    expect((await confirmar({ accountId: a.id, importLogId: j.importLogId, de: "2026-03-01", ate: "2099-01-01" })).status).toBe(400);
    expect((await confirmar({ accountId: s.accounts.outro.id, importLogId: j.importLogId, de: "2026-03-01", ate: "2026-03-31" })).status).toBe(404);
    expect(await prisma.importCoverage.count()).toBe(0);
  });
});

describe("/api/coverage para o painel da conta", () => {
  it("por conta e mês: total, sem categoria e com comprovante (anexo OU fatura Meta casada)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T12:00:00Z") });
    const conta = s.accounts.pixel.id; // já tem a transação de 01/10 (split só com operação = sem categoria)
    const cat = await prisma.category.create({ data: { type: "MANAGERIAL", name: "Custos" } });
    await prisma.transaction.create({ data: { accountId: conta, date: d("2026-10-05"), description: "Meta", amount: -10, currency: "USD", reference: "px-meta", isMetaCharge: true, hasReceipt: true } });
    const anexo = await prisma.transaction.create({ data: { accountId: conta, date: d("2026-10-06"), description: "Nota", amount: -5, currency: "USD", reference: "px-nota", splits: { create: { amount: -5, managerialCategoryId: cat.id } } } });
    await prisma.document.create({ data: { transactionId: anexo.id, filename: "nota.pdf", path: "r2:tx/x/nota.pdf" } });
    loginAs(admin);
    const px = (await (await coverage.GET()).json()).accounts.find((a: { id: string }) => a.id === conta);
    expect(px.meses["2026-10"]).toMatchObject({ total: 3, semCategoria: 2, comComprovante: 2 });
  });


  it("meses desde jan/2025; cada conta diz moeda, se a extração está escolhida, qual, e o nº da conta do OFX", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T12:00:00Z") });
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: "merc-chk" }) } });
    const xp = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "XP", currency: "BRL", name: "Pixel Ads LLC" } });
    await prisma.transaction.create({ data: { accountId: xp.id, date: d("2026-09-05"), description: "Pix", amount: -1, currency: "BRL", reference: "ofx:348:7226343:abc" } });
    loginAs(admin);
    const body = await (await coverage.GET()).json();
    expect(body.months[0]).toBe("2025-01");
    expect(body.months.at(-1)).toBe("2026-11");
    expect(body.months).toHaveLength(23);
    const merc = body.accounts.find((a: { id: string }) => a.id === s.accounts.pixel.id);
    expect(merc).toMatchObject({ bank: "Mercury", currency: "USD", configurada: true, extracao: "merc-chk", contaBanco: null });
    expect(body.accounts.find((a: { id: string }) => a.id === xp.id)).toMatchObject({ bank: "XP", currency: "BRL", configurada: false, extracao: null, contaBanco: "7226343" });
  });
});

describe("sem movimentação: alguém confere e marca (dono, 2026-11-13)", () => {
  const marcar = (json: Record<string, unknown>, method: "POST" | "DELETE" = "POST") => semMovimento[method](req("/api/coverage/sem-movimento", { method, json }));
  const mesDa = async (accountId: string, mes: string) => (await (await coverage.GET()).json()).accounts.find((a: { id: string }) => a.id === accountId).meses[mes];
  let conta: { id: string };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
    conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "EUR", name: "Payoneer EUR" } });
    // agosto inteiro importado; setembro faltando (sem lançamento); outubro importado de 02 a 21 (lançamentos dentro)
    await prisma.importCoverage.createMany({ data: [
      { accountId: conta.id, from: d("2026-08-01"), to: d("2026-09-01"), source: "arquivo", createdAt: d("2026-11-01T10:00:00Z") },
      { accountId: conta.id, from: d("2026-10-02"), to: d("2026-10-22"), source: "arquivo", createdAt: d("2026-11-01T10:05:00Z") },
    ] });
    await prisma.transaction.createMany({ data: [
      { accountId: conta.id, date: d("2026-08-10T10:00:00Z"), description: "A", amount: -40, currency: "EUR", reference: "t-ago" },
      { accountId: conta.id, date: d("2026-10-02T09:00:00Z"), description: "B", amount: -40, currency: "EUR", reference: "t-out1" },
      { accountId: conta.id, date: d("2026-10-21T23:00:00Z"), description: "C", amount: -13, currency: "EUR", reference: "t-out2" },
    ] });
  });

  it("mês sem importação e sem lançamento: marca, vira importado, fica quem marcou; desfazer volta", async () => {
    loginAs(admin);
    expect((await mesDa(conta.id, "2026-09")).imp).toBe("faltando");
    expect((await marcar({ accountId: conta.id, mes: "2026-09" })).status).toBe(200);
    expect(await mesDa(conta.id, "2026-09")).toMatchObject({ imp: "completo", total: 0 });
    const det = await (await detalhe.GET(req("/api/coverage/detalhe?accountId=" + conta.id + "&mes=2026-09"))).json();
    expect(det.importacoes).toMatchObject([{ fonte: "manual", quem: "Admin Pixel" }]);
    // a marcação (mais nova) não é "a última importação" da conta
    expect((await prisma.importCoverage.findFirstOrThrow({ where: { accountId: conta.id }, orderBy: { createdAt: "desc" } })).source).toBe("manual");
    const c = (await (await coverage.GET()).json()).accounts.find((a: { id: string }) => a.id === conta.id);
    expect(c.ultimaImportacao).toMatchObject({ fonte: "arquivo", quando: "2026-11-01T10:05:00.000Z" });

    expect((await marcar({ accountId: conta.id, mes: "2026-09" }, "DELETE")).status).toBe(200);
    expect((await mesDa(conta.id, "2026-09")).imp).toBe("faltando");
    expect((await marcar({ accountId: conta.id, mes: "2026-09" }, "DELETE")).status).toBe(404); // nada pra desfazer
  });

  it("mês importado só em parte, sem lançamento nos dias que faltam: marcar completa o mês; desfazer não mexe na importação", async () => {
    loginAs(admin);
    expect((await mesDa(conta.id, "2026-10")).imp).toBe("parcial");
    expect((await marcar({ accountId: conta.id, mes: "2026-10" })).status).toBe(200);
    expect(await mesDa(conta.id, "2026-10")).toMatchObject({ imp: "completo", total: 2 });
    expect((await marcar({ accountId: conta.id, mes: "2026-10" }, "DELETE")).status).toBe(200);
    expect((await mesDa(conta.id, "2026-10")).imp).toBe("parcial");
    expect(await prisma.importCoverage.count({ where: { accountId: conta.id, source: "arquivo" } })).toBe(2);
  });

  it("recusa: lançamento em dia sem cobertura (tem que importar), mês que não acabou, mês já completo — nada gravado", async () => {
    loginAs(admin);
    await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-10-25T10:00:00Z"), description: "D", amount: -5, currency: "EUR", reference: "t-out3" } });
    const r = await marcar({ accountId: conta.id, mes: "2026-10" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/1 lançamento\(s\) em dias que nenhuma importação cobre \(25\/10\/2026\)/);
    expect((await marcar({ accountId: conta.id, mes: "2026-11" })).status).toBe(400); // novembro ainda corre
    expect((await marcar({ accountId: conta.id, mes: "2026-08" })).status).toBe(400); // já importado
    expect((await marcar({ accountId: conta.id, mes: "2026-13" })).status).toBe(400);
    expect(await prisma.importCoverage.count({ where: { accountId: conta.id, source: "manual" } })).toBe(0);
  });

  it("antes do 1º dado da conta: marca o trecho todo de uma vez (jan/25 a jan/26 de uma conta que só tem dado em fev/26)", async () => {
    const usd = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "USD", name: "Payoneer USD" } });
    await prisma.transaction.create({ data: { accountId: usd.id, date: d("2026-02-03T20:39:00Z"), description: "Credito", amount: 100, currency: "USD", reference: "u-fev" } });
    await prisma.importCoverage.create({ data: { accountId: usd.id, from: d("2026-02-01"), to: d("2026-03-01"), source: "arquivo" } });
    loginAs(admin);
    expect((await mesDa(usd.id, "2025-01")).imp).toBe("antes");
    const r = await marcar({ accountId: usd.id, mes: "2025-01", ate: "2026-01" });
    expect(r.status).toBe(200);
    expect((await r.json()).meses).toHaveLength(13);
    const meses = (await (await coverage.GET()).json()).accounts.find((a: { id: string }) => a.id === usd.id).meses;
    expect(["2025-01", "2025-07", "2026-01", "2026-02"].map((m) => meses[m].imp)).toEqual(["completo", "completo", "completo", "completo"]);
    expect(meses["2026-03"].imp).toBe("faltando"); // depois do 1º dado continua mês a mês
    // desfazer é por mês
    expect((await marcar({ accountId: usd.id, mes: "2025-07" }, "DELETE")).status).toBe(200);
    expect(await prisma.importCoverage.count({ where: { accountId: usd.id, source: "manual" } })).toBe(12);
  });

  it("intervalo: mês já completo fica como está; lançamento solto em qualquer mês recusa tudo; até antes do mês ou no mês atual = 400", async () => {
    loginAs(admin);
    const r = await marcar({ accountId: conta.id, mes: "2026-08", ate: "2026-09" }); // agosto já importado
    expect(await r.json()).toMatchObject({ ok: true, meses: ["2026-09"] });
    await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-07-10T10:00:00Z"), description: "X", amount: -1, currency: "EUR", reference: "t-jul" } });
    expect((await marcar({ accountId: conta.id, mes: "2026-06", ate: "2026-07" })).status).toBe(409);
    expect((await marcar({ accountId: conta.id, mes: "2026-06", ate: "2026-05" })).status).toBe(400);
    expect((await marcar({ accountId: conta.id, mes: "2026-06", ate: "2026-11" })).status).toBe(400);
    expect(await prisma.importCoverage.count({ where: { accountId: conta.id, source: "manual" } })).toBe(1); // só a de setembro
  });

  it("membro = 403; conta de outro grupo = 404", async () => {
    loginAs(s.users.pixel);
    expect((await marcar({ accountId: conta.id, mes: "2026-09" })).status).toBe(403);
    loginAs(admin);
    expect((await marcar({ accountId: s.accounts.outro.id, mes: "2026-09" })).status).toBe(404);
    expect(await prisma.importCoverage.count({ where: { source: "manual" } })).toBe(0);
  });
});
