import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as importRevolutCsv from "@/app/api/admin/import-revolut-csv/route";
import * as importReceipts from "@/app/api/admin/import-receipts/route";
import * as fechamento from "@/app/api/fechamento/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Histórico de importações do Fechamento Meta (pedido do dono em 2026-10-16: "onde isso fica
 * registrado? como sei o que deu certo?"). O arquivo não é guardado — só o que foi lido dele.
 */
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const UUID_SEM_PAR = "1f8fad5b-d9cb-469f-a165-70867728950f";
const CSV = [
  "ID,Description,Card number,Card label,Date completed (UTC)",
  `${UUID},Facebk *abcd123xyz,****1234,BM 1,2026-10-03 10:00:00`,
  `${UUID_SEM_PAR},Facebk *zzzz999yyy,****1234,BM 1,2026-10-20 10:00:00`,
].join("\n");

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  await prisma.transaction.create({
    data: { accountId: s.accounts.pixel.id, date: new Date("2026-10-03"), description: "Meta Pay", amount: -50, currency: "USD", reference: `revolut:${UUID}:leg1`, isMetaCharge: true },
  });
  // "hoje" = 15/11/2026: outubro encerrado (as contas do teste não têm sync configurado → mês liberado)
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T12:00:00Z") });
});
afterEach(() => { vi.useRealTimers(); });

const subirCsv = () =>
  importRevolutCsv.POST(new Request("http://localhost/api/admin/import-revolut-csv", { method: "POST", headers: { "content-type": "text/csv", "x-filename": encodeURIComponent("extrato-outubro-ç.csv") }, body: CSV }));
const subirPdfs = () =>
  importReceipts.POST(req("/api/admin/import-receipts", { method: "POST", json: [{ transactionId: "pdf-1", referenceNumber: "ABCD123XYZ", date: "2026-10-03" }] }));
const historico = async (who: { email: string }, mes = "2026-10") => {
  loginAs(who);
  return (await (await fechamento.GET(req(`/api/fechamento?month=${mes}`))).json()).importacoes as Array<Record<string, unknown>>;
};

describe("histórico de importações", () => {
  it("CSV da Revolut: grava quem, quando, o arquivo, o período do conteúdo, as empresas e o resultado por conta", async () => {
    loginAs(admin);
    expect((await subirCsv()).status).toBe(200);
    const log = await prisma.importLog.findFirstOrThrow();
    expect(log).toMatchObject({ kind: "csv_revolut", filename: "extrato-outubro-ç.csv", userId: admin.id, companyIds: [s.companies.pixel.id] });
    expect(log.periodFrom?.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(log.periodTo?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(JSON.parse(log.summary)).toMatchObject({ gravados: 1, jaTinham: 0, semTransacaoNoBanco: 1, porConta: { "Mercury Pixel": 1 } });
  });

  it("faturas PDF: grava o lote (sem empresa — fatura não é de uma empresa só)", async () => {
    loginAs(admin);
    expect((await subirPdfs()).status).toBe(200);
    const log = await prisma.importLog.findFirstOrThrow();
    expect(log).toMatchObject({ kind: "faturas_pdf", userId: admin.id, companyIds: [] });
    expect(JSON.parse(log.summary)).toMatchObject({ recebidos: 1, inseridos: 1 });
  });

  it("Fechamento mostra as importações que cobrem o mês; outro grupo não vê o CSV da Pixel (mas vê os PDFs)", async () => {
    loginAs(admin);
    await subirCsv();
    await subirPdfs();
    const meu = await historico(admin);
    expect(meu.map((i) => i.tipo).sort()).toEqual(["csv_revolut", "faturas_pdf"]);
    expect(meu.find((i) => i.tipo === "csv_revolut")).toMatchObject({ arquivo: "extrato-outubro-ç.csv", quem: "Admin Pixel", de: "2026-10-03", ate: "2026-10-20" });
    expect((await historico(s.users.outro)).map((i) => i.tipo)).toEqual(["faturas_pdf"]);
    expect(await historico(admin, "2026-09")).toEqual([]); // nada de outubro aparece em setembro
  });

  it("passo 2 diz de qual conta falta o CSV (sem código no mês, por conta)", async () => {
    loginAs(admin);
    const contas = (await (await fechamento.GET(req("/api/fechamento?month=2026-10"))).json()).contas as Array<{ id: string; semCodigoNoMes: number }>;
    expect(contas.find((c) => c.id === s.accounts.pixel.id)?.semCodigoNoMes).toBe(1); // a cobrança Revolut ainda sem o código
    await subirCsv();
    const depois = (await (await fechamento.GET(req("/api/fechamento?month=2026-10"))).json()).contas as Array<{ id: string; semCodigoNoMes: number }>;
    expect(depois.find((c) => c.id === s.accounts.pixel.id)?.semCodigoNoMes).toBe(0); // o CSV trouxe o código
  });
});
