import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as importRevolutCsv from "@/app/api/admin/import-revolut-csv/route";
import * as fechamento from "@/app/api/fechamento/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * CSV da Revolut conserta linha antiga (achado em 2026-10-22): 1.204 cobranças gravadas pelo sistema
 * antigo em 28/08 estavam sem a marca de cobrança Meta e sem cartão → sumiam do Fechamento. A linha do
 * CSV com "Facebk *XXXX" prova que é cobrança Meta: marca e preenche o cartão vazio.
 */
const ANTIGA = "0f8fad5b-d9cb-469f-a165-70867728950e";
const COM_CARTAO = "1f8fad5b-d9cb-469f-a165-70867728950f";
const DO_OUTRO = "2f8fad5b-d9cb-469f-a165-708677289510";
const CSV = [
  "ID,Description,Card number,Card label,Date completed (UTC)",
  `${ANTIGA},Facebk *abcd123xyz,****3405,BM 11-04 Driztrail,2026-08-10 10:00:00`,
  `${COM_CARTAO},Facebk *efgh456uvw,****1111,Nome do CSV,2026-08-11 10:00:00`,
  `${DO_OUTRO},Facebk *ijkl789rst,****2222,Cartão do outro,2026-08-12 10:00:00`,
].join("\n");

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.metaReceipt.deleteMany();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  const tx = (accountId: string, uuid: string, extra: Record<string, unknown>) =>
    prisma.transaction.create({ data: { accountId, reference: `revolut:${uuid}:leg1`, date: new Date("2026-08-10"), description: "Facebook", amount: -100, currency: "USD", ...extra } });
  // como o sistema antigo gravou: sem marca, sem cartão — e o código já veio de um CSV anterior
  await tx(s.accounts.pixel.id, ANTIGA, { isMetaCharge: false, metaRef: "abcd123xyz" });
  // já marcada e com cartão: o cartão NÃO pode ser trocado pelo do CSV
  await tx(s.accounts.pixel.id, COM_CARTAO, { isMetaCharge: true, cardLast4: "9999", cardLabel: "Nome do banco" });
  // de OUTRO grupo: o admin da Pixel não mexe
  await tx(s.accounts.outro.id, DO_OUTRO, { isMetaCharge: false });
  await prisma.metaReceipt.create({ data: { transactionId: "r1", referenceNumber: "ABCD123XYZ", accountId: "act_1", accountName: "BM 11 AV - 04" } });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T12:00:00Z") });
});
afterEach(() => vi.useRealTimers());

const subir = async () =>
  (await importRevolutCsv.POST(new Request("http://localhost/api/admin/import-revolut-csv", { method: "POST", headers: { "content-type": "text/csv" }, body: CSV }))).json();
const linha = (uuid: string) => prisma.transaction.findFirstOrThrow({ where: { reference: `revolut:${uuid}:leg1` } });

describe("CSV da Revolut conserta cobrança antiga sem marca/cartão", () => {
  it("marca como Meta, preenche o cartão vazio e a cobrança passa a contar no Fechamento (com a fatura)", async () => {
    loginAs(admin);
    const r = await subir();
    expect(r).toMatchObject({ metaRefGravados: 1, jaTinhamOMesmoCodigo: 1, marcadasMeta: 1, cartoesPreenchidos: 1 });
    expect(await linha(ANTIGA)).toMatchObject({ isMetaCharge: true, cardLast4: "3405", cardLabel: "BM 11-04 Driztrail", hasReceipt: true });

    const f = await (await fechamento.GET(req("/api/fechamento?month=2026-08"))).json();
    expect(f.cartoes).toEqual(expect.arrayContaining([expect.objectContaining({ cartaoFinal: "3405", cartaoNome: "BM 11-04 Driztrail", ok: 1 })]));
  });

  it("nunca troca cartão que já existe", async () => {
    loginAs(admin);
    await subir();
    expect(await linha(COM_CARTAO)).toMatchObject({ isMetaCharge: true, cardLast4: "9999", cardLabel: "Nome do banco", metaRef: "efgh456uvw" });
  });

  it("subir de novo não conserta nada (já está certo)", async () => {
    loginAs(admin);
    await subir();
    expect(await subir()).toMatchObject({ metaRefGravados: 0, marcadasMeta: 0, cartoesPreenchidos: 0 });
  });

  it("admin de um grupo não mexe em linha de outro grupo, mesmo com o UUID no CSV", async () => {
    loginAs(admin);
    await subir();
    expect(await linha(DO_OUTRO)).toMatchObject({ isMetaCharge: false, cardLast4: null, metaRef: null });
  });
});
