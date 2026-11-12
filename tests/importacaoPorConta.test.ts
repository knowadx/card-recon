import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import * as coverage from "@/app/api/coverage/route";
import * as periodo from "@/app/api/coverage/periodo/route";
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
  it("CSV genérico: devolve a 1ª e a última data e o histórico; sem confirmar, nenhuma cobertura", async () => {
    const conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Outro", currency: "USD", name: "Banco qualquer" } });
    loginAs(admin);
    const csv = "date,description,amount\n2026-03-05,Fornecedor,-10\n2026-03-28,Cliente,50\n2026-03-12,Taxa,-1\n";
    const r = await enviar(importCsv, conta.id, new Blob([csv]), "marco.csv");
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ imported: 3, periodo: { de: "2026-03-05", ate: "2026-03-28" } });
    const log = await prisma.importLog.findUniqueOrThrow({ where: { id: j.importLogId } });
    expect([log.kind, log.filename, JSON.parse(log.summary).accountId]).toEqual(["csv", "marco.csv", conta.id]);
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
    expect(rd).toMatchObject({ imported: 2, periodo: { de: "2026-06-02", ate: "2026-06-20" } });

    const planilha = XLSX.utils.aoa_to_sheet([["Date", "Event", "Payer", "Beneficiary", "Amount"], ["Start date", "Initial balance", "", "", ""], ["2026-07-03", "Pagamento", "", "Fornecedor", "-15"], ["2026-07-30", "Recebimento", "Cliente", "", "40"]]);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Extrato");
    const xls = XLSX.write(livro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const rh = await (await enviar(importHusky, husky.id, new Blob([xls]), "husky.xlsx")).json();
    expect(rh).toMatchObject({ imported: 2, periodo: { de: "2026-07-03", ate: "2026-07-30" } });
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
