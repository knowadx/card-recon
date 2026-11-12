import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as importPayoneer from "@/app/api/transactions/import/payoneer/route";
import * as periodo from "@/app/api/coverage/periodo/route";
import { dataPayoneer, lerPayoneer, valorPayoneer } from "@/lib/payoneer";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * CSV de movimentação do Payoneer (pedido do dono em 2026-11-12). Sintético, no MESMO formato do arquivo real:
 * data MM-DD-AAAA + hora UTC, débito negativo, saldo corrido, "Card charge (FACEBK *código)". Ordem: mais novo primeiro.
 * Saldos encadeados (do mais antigo): 950 → (−50) 900 → (+500) 1400 → (−50) 1350 → (−50) 1300 — as duas últimas são
 * cobranças idênticas no mesmo segundo.
 */
const CAB = "Currency,Payout method,Transaction date,Transaction time,Time zone,Credit amount,Debit amount,Status,Running balance,Description";
const L = {
  e5: "EUR,EUR balance,12-31-2025,12:00:00,UTC,0,-50,Completed,1300,Card charge (FACEBK *AAAA1111B2)",
  e4: "EUR,EUR balance,12-31-2025,12:00:00,UTC,0,-50,Completed,1350,Card charge (FACEBK *AAAA1111B2)",
  e3: "EUR,EUR balance,12-30-2025,09:00:00,UTC,500,0,Completed,1400,Transfer from Cliente Exemplo",
  e2: "EUR,EUR balance,12-29-2025,18:30:00,UTC,0,-50,Completed,900,Card charge (FACEBK *CCCC3333D2)",
  e1: "EUR,EUR balance,12-28-2025,03:49:54,UTC,0,-100,Completed,950,Card charge (FACEBK *EEEE5555F2)",
  pend: "EUR,EUR balance,12-31-2025,13:00:00,UTC,0,-10,Pending,1290,Card charge (FACEBK *GGGG7777H2)",
  usd: "USD,USD balance,12-15-2025,10:00:00,UTC,2000,0,Completed,2000,Transfer from Cliente Exemplo",
};
const CSV = [CAB, L.pend, L.e5, L.e4, L.e3, L.e2, L.e1, L.usd].join("\n");

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
let conta: { id: string };
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  conta = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Payoneer", currency: "EUR", name: "Payoneer Pixel" } });
});

const enviar = (accountId: string, texto = CSV) => {
  const fd = new FormData();
  fd.append("file", new File([texto], "payoneer.csv"));
  fd.append("accountId", accountId);
  return importPayoneer.POST(new Request("http://localhost/x", { method: "POST", body: fd }));
};

describe("leitura do CSV do Payoneer", () => {
  it("data MM-DD-AAAA + hora UTC, valor = crédito + débito, moeda da linha, só Completed", () => {
    expect(dataPayoneer("12-31-2025", "12:51:50", "UTC")?.toISOString()).toBe("2025-12-31T12:51:50.000Z");
    expect(dataPayoneer("12-31-2025", "12:51:50", "EST")?.toISOString()).toBe("2025-12-31T12:00:00.000Z"); // outro fuso: só o dia
    expect(dataPayoneer("02-31-2025", "10:00:00", "UTC")).toBeNull();
    expect(valorPayoneer("-1,234.50")).toBe(-1234.5);
    const { extrato } = lerPayoneer(CSV);
    expect(extrato!.lancamentos.map((l) => [l.moeda, l.valor, l.data.toISOString().slice(0, 10)])).toEqual([
      ["EUR", -50, "2025-12-31"], ["EUR", -50, "2025-12-31"], ["EUR", 500, "2025-12-30"], ["EUR", -50, "2025-12-29"], ["EUR", -100, "2025-12-28"], ["USD", 2000, "2025-12-15"],
    ]);
    expect(extrato!.naoConcluidos).toBe(1);
  });

  it("duas cobranças idênticas no mesmo segundo viram 1ª e 2ª ocorrência (as duas entram)", () => {
    const [a, b] = lerPayoneer(CSV).extrato!.lancamentos;
    expect(a.chave).not.toBe(b.chave);
    expect([a.chave.endsWith(":1"), b.chave.endsWith(":2")]).toEqual([true, true]);
  });

  it("sequência do saldo: confere no arquivo inteiro; tirar uma linha do meio = quebra", () => {
    expect(lerPayoneer(CSV).extrato!.quebrasDeSaldo).toBe(0);
    expect(lerPayoneer([CAB, L.e5, L.e4, L.e2, L.e1].join("\n")).extrato!.quebrasDeSaldo).toBe(1); // sem o crédito de 500
  });

  it("arquivo de outro formato (ex.: o de Transaction ID) = erro claro, com as colunas que vieram", () => {
    const r = lerPayoneer('Date,Description,Amount,Currency,Status,Transaction ID\n"07 Nov, 2026",X,"-1.00",USD,Completed,1');
    expect(r.erro).toMatch(/não parece o CSV de movimentação do Payoneer/);
  });
});

describe("POST /api/transactions/import/payoneer", () => {
  it("importa, marca as cobranças Meta (FACEBK), reimportar não duplica, sugere o período e a confirmação cobre", async () => {
    loginAs(admin);
    const r = await (await enviar(conta.id)).json();
    expect(r).toMatchObject({ imported: 6, skipped: 0, naoConcluidos: 1, quebrasDeSaldo: 0, periodo: { de: "2025-12-15", ate: "2025-12-31" } });
    expect((await (await enviar(conta.id)).json())).toMatchObject({ imported: 0, skipped: 6 });
    const meta = await prisma.transaction.findMany({ where: { accountId: conta.id, isMetaCharge: true }, select: { metaRef: true }, orderBy: { metaRef: "asc" } });
    expect(meta.map((m) => m.metaRef)).toEqual(["AAAA1111B2", "AAAA1111B2", "CCCC3333D2", "EEEE5555F2"]);
    expect(await prisma.transaction.count({ where: { accountId: conta.id, currency: "USD" } })).toBe(1);
    expect((await periodo.POST(req("/api/coverage/periodo", { method: "POST", json: { accountId: conta.id, importLogId: r.importLogId, de: "2025-12-01", ate: "2025-12-31" } }))).status).toBe(200);
    expect(await prisma.importCoverage.findMany({ where: { accountId: conta.id }, select: { source: true } })).toEqual([{ source: "arquivo" }]);
  });

  it("conta que não é Payoneer = 400; membro = 403; outro grupo = 404 — nada gravado", async () => {
    loginAs(admin);
    expect((await enviar(s.accounts.pixel.id)).status).toBe(400); // Mercury
    loginAs(s.users.pixel);
    expect((await enviar(conta.id)).status).toBe(403);
    const outro = await prisma.account.create({ data: { companyId: s.companies.outro.id, bank: "Payoneer", currency: "EUR", name: "Payoneer Outro" } });
    loginAs(admin);
    expect((await enviar(outro.id)).status).toBe(404);
    expect(await prisma.transaction.count({ where: { reference: { startsWith: "payoneer:" } } })).toBe(0);
  });
});
