import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as arquivosRoute from "@/app/api/admin/import-receipts/arquivos/route";
import * as importReceipts from "@/app/api/admin/import-receipts/route";
import * as pdfRoute from "@/app/api/faturas-meta/[id]/pdf/route";
import * as txRoute from "@/app/api/transactions/[id]/route";
import * as cobrancas from "@/app/api/fechamento/cobrancas/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * PDF da fatura da Meta guardado no R2 (pedido do dono em 2026-10-24). R2 simulado: guarda quais
 * chaves "existem" e responde HEAD; nada sai da máquina.
 */
const R2 = { R2_ACCOUNT_ID: "conta123", R2_BUCKET: "pixelfinance-arquivos", R2_ACCESS_KEY_ID: "AKID", R2_SECRET_ACCESS_KEY: "SECRET" };
const ID_OK = "1111111111-2222222222";
const ID_NAO_SUBIU = "3333333333-4444444444";

let noR2: Set<string>; // chaves que "chegaram" no R2
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.metaReceipt.deleteMany();
  Object.entries(R2).forEach(([k, v]) => vi.stubEnv(k, v));
  noR2 = new Set([`faturas-meta/${ID_OK}.pdf`]);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(input, init);
    const chave = decodeURIComponent(new URL(r.url).pathname).replace("/pixelfinance-arquivos/", "");
    if (r.method === "HEAD") return noR2.has(chave)
      ? new Response(null, { status: 200, headers: { "content-length": "48000", "content-type": "application/pdf" } })
      : new Response(null, { status: 404 });
    return new Response("inesperado", { status: 500 });
  }));
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  // cobrança da Pixel com o código da fatura
  await prisma.transaction.create({
    data: { accountId: s.accounts.pixel.id, reference: "meta-1", date: new Date("2026-09-10"), description: "Facebk *abcd123xyz", amount: -100, currency: "USD", isMetaCharge: true, metaRef: "abcd123xyz", cardLast4: "9514" },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const urls = (ids: string[]) => arquivosRoute.POST(req("/api/admin/import-receipts/arquivos", { method: "POST", json: { ids } }));
const importar = (rows: unknown[]) => importReceipts.POST(req("/api/admin/import-receipts", { method: "POST", json: rows }));
const fatura = (id: string, extra: Record<string, unknown> = {}) => ({ transactionId: id, referenceNumber: id === ID_OK ? "ABCD123XYZ" : "OUTRO00001", accountName: "BM 21 - Conta A", date: "2026-09-10T10:00:00Z", ...extra });

describe("PDF da fatura da Meta no R2", () => {
  it("URLs de envio: nome fixo por id da Meta; id inválido = 400; membro = 403", async () => {
    loginAs(admin);
    const r = await (await urls([ID_OK])).json();
    expect(new URL(r.urls[ID_OK]).pathname).toBe(`/pixelfinance-arquivos/faturas-meta/${ID_OK}.pdf`);
    expect((await urls(["../../etc/passwd"])).status).toBe(400);
    loginAs(s.users.pixel);
    expect((await urls([ID_OK])).status).toBe(403);
  });

  it("só vira vínculo o PDF que o R2 confirma: o que a tela diz que subiu mas não chegou fica sem arquivo", async () => {
    loginAs(admin);
    const r = await (await importar([fatura(ID_OK, { arquivo: true }), fatura(ID_NAO_SUBIU, { arquivo: true })])).json();
    expect(r).toMatchObject({ inseridos: 2, pdfsGuardados: 1 });
    expect(await prisma.metaReceipt.findUnique({ where: { transactionId: ID_OK } })).toMatchObject({ fileKey: `faturas-meta/${ID_OK}.pdf`, fileSize: 48000 });
    expect(await prisma.metaReceipt.findUnique({ where: { transactionId: ID_NAO_SUBIU } })).toMatchObject({ fileKey: null });
  });

  it("reimportar a fatura SEM o arquivo mantém o PDF que já estava guardado", async () => {
    loginAs(admin);
    await importar([fatura(ID_OK, { arquivo: true })]);
    await importar([fatura(ID_OK)]); // sem arquivo desta vez
    expect(await prisma.metaReceipt.findUnique({ where: { transactionId: ID_OK } })).toMatchObject({ fileKey: `faturas-meta/${ID_OK}.pdf` });
  });

  it("abrir o PDF: quem vê a cobrança abre (link de poucos minutos); outro grupo = 404; sem PDF = 404", async () => {
    loginAs(admin);
    await importar([fatura(ID_OK, { arquivo: true }), fatura(ID_NAO_SUBIU)]);
    const comPdf = await prisma.metaReceipt.findUniqueOrThrow({ where: { transactionId: ID_OK } });
    const semPdf = await prisma.metaReceipt.findUniqueOrThrow({ where: { transactionId: ID_NAO_SUBIU } });

    loginAs(s.users.pixel);
    const ok = await pdfRoute.GET(req(`/api/faturas-meta/${comPdf.id}/pdf`), params({ id: comPdf.id }));
    expect(ok.status).toBe(302);
    const destino = new URL(ok.headers.get("location")!);
    expect(destino.pathname).toBe(`/pixelfinance-arquivos/faturas-meta/${ID_OK}.pdf`);
    expect(destino.searchParams.get("X-Amz-Expires")).toBeTruthy();

    loginAs(s.users.outro); // não enxerga nenhuma cobrança com esse código
    expect((await pdfRoute.GET(req(`/api/faturas-meta/${comPdf.id}/pdf`), params({ id: comPdf.id }))).status).toBe(404);
    loginAs(s.users.root);
    expect((await pdfRoute.GET(req(`/api/faturas-meta/${semPdf.id}/pdf`), params({ id: semPdf.id }))).status).toBe(404);
  });

  it("a cobrança mostra o PDF: no detalhe da transação e na lista do cartão do Fechamento", async () => {
    loginAs(admin);
    await importar([fatura(ID_OK, { arquivo: true })]);
    const recibo = await prisma.metaReceipt.findUniqueOrThrow({ where: { transactionId: ID_OK } });
    const tx = await prisma.transaction.findFirstOrThrow({ where: { reference: "meta-1" } });
    loginAs(s.users.pixel);
    expect(await (await txRoute.GET(req(`/api/transactions/${tx.id}`), params({ id: tx.id }))).json()).toMatchObject({ faturaMeta: { id: recibo.id, pdf: true, contaAnuncio: "BM 21 - Conta A" } });
    const lista = await (await cobrancas.GET(req(`/api/fechamento/cobrancas?month=2026-09&cartao=${s.accounts.pixel.id}:9514`))).json();
    expect(lista.cobrancas[0]).toMatchObject({ situacao: "ok", faturaId: recibo.id, faturaPdf: true });
  });
});
