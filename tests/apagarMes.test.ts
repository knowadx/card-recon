import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as apagar from "@/app/api/coverage/apagar-mes/route";
import * as coverage from "@/app/api/coverage/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Apagar a importação de uma conta num mês (dono, 2026-11-13: "substituir alguma importação no mês, por erro no
 * extrato"). Decisões dele: a unidade é o MÊS DA CONTA; a categorização vai junto, mas a confirmação mostra antes.
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
let conta: { id: string };
const d = (x: string) => new Date(x);

beforeEach(async () => {
  resetRequest();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "EUR", name: "Payoneer EUR" } });
  const cat = await prisma.category.create({ data: { type: "MANAGERIAL", name: "Mídia" } });
  // outubro: 1 categorizado, 1 com fatura Meta, 1 com anexo; setembro e novembro não podem ser tocados
  await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-10-03T10:00:00Z"), description: "A", amount: -40, currency: "EUR", reference: "o1", splits: { create: { amount: -40, managerialCategoryId: cat.id } } } });
  await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-10-10T10:00:00Z"), description: "B", amount: -40, currency: "EUR", reference: "o2", isMetaCharge: true, hasReceipt: true } });
  const anexo = await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-10-31T23:59:00Z"), description: "C", amount: -5, currency: "EUR", reference: "o3" } });
  await prisma.document.create({ data: { transactionId: anexo.id, filename: "nota.pdf", path: "r2:tx/x/nota.pdf" } });
  await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-09-30T23:00:00Z"), description: "set", amount: -1, currency: "EUR", reference: "s1" } });
  await prisma.transaction.create({ data: { accountId: conta.id, date: d("2026-11-01T00:30:00Z"), description: "nov", amount: -1, currency: "EUR", reference: "n1" } });
  // um extrato que cobriu set→nov inteiro (passa do mês pros dois lados) + uma marca manual só de outubro
  await prisma.importCoverage.createMany({ data: [
    { accountId: conta.id, from: d("2026-09-01"), to: d("2026-11-14"), source: "arquivo", userId: admin.id, createdAt: d("2026-11-10T09:00:00Z") },
    { accountId: conta.id, from: d("2026-10-01"), to: d("2026-11-01"), source: "manual", userId: admin.id },
  ] });
});
afterEach(() => vi.useRealTimers());

const previa = (accountId: string, mes: string) => apagar.GET(req(`/api/coverage/apagar-mes?accountId=${accountId}&mes=${mes}`));
const apagarMes = (json: Record<string, unknown>) => apagar.DELETE(req("/api/coverage/apagar-mes", { method: "DELETE", json }));

describe("apagar a importação de uma conta num mês", () => {
  it("prévia diz o que vai junto; apagar tira os lançamentos do mês e corta a marca de importado só no mês", async () => {
    loginAs(admin);
    expect(await (await previa(conta.id, "2026-10")).json()).toEqual({ lancamentos: 3, categorizados: 1, comFaturaMeta: 1, comAnexo: 1, marcaDeImportado: true });

    const r = await apagarMes({ accountId: conta.id, mes: "2026-10", esperado: 3 });
    expect(r.status).toBe(200);
    // outubro some (com categorização e anexo); 30/09 23:00 e 01/11 00:30 ficam
    expect((await prisma.transaction.findMany({ where: { accountId: conta.id }, select: { reference: true }, orderBy: { date: "asc" } })).map((t) => t.reference)).toEqual(["s1", "n1"]);
    expect(await prisma.transactionSplit.count({ where: { transaction: { accountId: conta.id } } })).toBe(0);
    expect(await prisma.document.count({ where: { filename: "nota.pdf" } })).toBe(0);
    // o extrato set→nov vira set + nov (mesma origem, quem e quando); a marca manual de outubro some
    expect(await prisma.importCoverage.findMany({ where: { accountId: conta.id }, select: { from: true, to: true, source: true, userId: true, createdAt: true }, orderBy: { from: "asc" } })).toEqual([
      { from: d("2026-09-01"), to: d("2026-10-01"), source: "arquivo", userId: admin.id, createdAt: d("2026-11-10T09:00:00Z") },
      { from: d("2026-11-01"), to: d("2026-11-14"), source: "arquivo", userId: admin.id, createdAt: d("2026-11-10T09:00:00Z") },
    ]);
    const meses = (await (await coverage.GET()).json()).accounts.find((a: { id: string }) => a.id === conta.id).meses;
    expect([meses["2026-09"].imp, meses["2026-10"].imp]).toEqual(["completo", "faltando"]);
    // fica no histórico: quem, quando, quantos
    const log = await prisma.importLog.findFirstOrThrow({ where: { kind: "exclusao" } });
    expect([log.userId, JSON.parse(log.summary)]).toEqual([admin.id, { lancamentos: 3, categorizados: 1, comFaturaMeta: 1, comAnexo: 1, marcaDeImportado: true, conta: "Payoneer EUR", accountId: conta.id, mes: "2026-10" }]);
  });

  it("número diferente do que a confirmação mostrou = 409 e nada apagado; sem 'esperado' = 400", async () => {
    loginAs(admin);
    const r = await apagarMes({ accountId: conta.id, mes: "2026-10", esperado: 2 });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/tem agora 3 lançamento\(s\) nesse mês, não 2/);
    expect((await apagarMes({ accountId: conta.id, mes: "2026-10" })).status).toBe(400);
    expect(await prisma.transaction.count({ where: { accountId: conta.id } })).toBe(5);
    expect(await prisma.importCoverage.count({ where: { accountId: conta.id } })).toBe(2);
    expect(await prisma.importLog.count({ where: { kind: "exclusao" } })).toBe(0);
  });

  it("mês sem nada importado = 400; membro = 403; conta de outro grupo = 404 — nada apagado", async () => {
    loginAs(admin);
    expect((await apagarMes({ accountId: conta.id, mes: "2026-05", esperado: 0 })).status).toBe(400);
    loginAs(s.users.pixel);
    expect((await previa(conta.id, "2026-10")).status).toBe(403);
    expect((await apagarMes({ accountId: conta.id, mes: "2026-10", esperado: 3 })).status).toBe(403);
    loginAs(admin);
    expect((await apagarMes({ accountId: s.accounts.outro.id, mes: "2026-10", esperado: 0 })).status).toBe(404);
    expect(await prisma.transaction.count({ where: { accountId: conta.id } })).toBe(5);
  });
});
