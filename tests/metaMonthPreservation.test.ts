import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

// sem rede: a Meta "devolve" só as cobranças de JUNHO (a janela pedida)
vi.mock("@/lib/meta", () => ({
  fetchBillingCharges: vi.fn(async () => [
    { transactionId: "meta-jun-1", amountUsd: 300, currency: "USD", chargedAt: new Date("2026-06-10T12:00:00Z") },
  ]),
}));

const importReceipts = await import("@/app/api/admin/import-receipts/route");
const { syncBillingCharges } = await import("@/lib/metaCharges");

/**
 * Pergunta do dono (2026-10-16): conferir Fatura Meta × Cobrança de um mês novo APAGA o mês
 * anterior? Estes testes provam que não — nos 3 dados do check (PDFs, "Possui Fatura" e o que a
 * Meta diz que cobrou).
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let txMaio: { id: string };
let txJunho: { id: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  const meta = (date: string, ref: string, metaRef: string) =>
    prisma.transaction.create({
      data: { accountId: s.accounts.pixel.id, date: new Date(date), description: `FACEBK *${metaRef}`, amount: -100, currency: "USD", reference: ref, isMetaCharge: true, metaRef },
    });
  txMaio = await meta("2026-05-15", "mai-1", "maio111aa");
  txJunho = await meta("2026-06-15", "jun-1", "junho222bb");
  loginAs(s.users.root);
});

const importar = (rows: unknown[]) => importReceipts.POST(req("/api/admin/import-receipts", { method: "POST", json: rows }));
const receiptMaio = { transactionId: "pdf-maio", referenceNumber: "MAIO111AA", date: "2026-05-15", amountUsd: 100 };
const receiptJunho = { transactionId: "pdf-junho", referenceNumber: "JUNHO222BB", date: "2026-06-15", amountUsd: 100 };
const flag = async (id: string) => (await prisma.transaction.findUniqueOrThrow({ where: { id } })).hasReceipt;

describe("conferência Meta mês a mês preserva o mês anterior", () => {
  it("importar os PDFs de junho NÃO apaga os de maio, e maio continua 'Possui Fatura'", async () => {
    expect((await importar([receiptMaio])).status).toBe(200);
    expect(await flag(txMaio.id)).toBe(true);
    expect(await flag(txJunho.id)).toBe(false);

    expect((await importar([receiptJunho])).status).toBe(200);
    expect(await prisma.metaReceipt.count({ where: { transactionId: "pdf-maio" } })).toBe(1);
    expect(await flag(txMaio.id)).toBe(true);
    expect(await flag(txJunho.id)).toBe(true);
  });

  it("refazer junho é idempotente: não duplica e não mexe em maio", async () => {
    await importar([receiptMaio]);
    await importar([receiptJunho]);
    await importar([receiptJunho]);
    expect(await prisma.metaReceipt.count()).toBe(2);
    expect(await flag(txMaio.id)).toBe(true);
  });

  it("sincronizar as cobranças da Meta de junho NÃO apaga as de maio (só acrescenta/atualiza)", async () => {
    await prisma.metaAdAccount.create({ data: { accountId: "act_1", name: "Conta 1", operationId: s.operations.pixel.id, company: "Op Pixel" } });
    await prisma.metaBillingCharge.create({
      data: { transactionId: "meta-mai-1", accountId: "act_1", accountName: "Conta 1", amountUsd: 200, currency: "USD", chargedAt: new Date("2026-05-10T12:00:00Z") },
    });
    const creds = [{ token: "tok", operationId: s.operations.pixel.id }];

    await syncBillingCharges(creds, "2026-06-01", "2026-06-30");
    await syncBillingCharges(creds, "2026-06-01", "2026-06-30"); // refazer o mês
    const ids = (await prisma.metaBillingCharge.findMany({ orderBy: { chargedAt: "asc" } })).map((c) => c.transactionId);
    expect(ids).toEqual(["meta-mai-1", "meta-jun-1"]);
  });
});
