import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as syncStatus from "@/app/api/sync/status/route";
import { getValidAccessToken } from "@/lib/revolut";
import { seedBankAccounts } from "./bankFakes";
import { loginAs, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Conexão Revolut é por ID da empresa (2026-10-30): as empresas foram renomeadas (PubViews OÜ →
 * PUBVIEWS OÜ) e a conexão guardada pelo NOME sumiu — a tela mostrava "Não conectado" em cada conta
 * (com o selo do topo dizendo "conectado") e o sync parou.
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.credential.deleteMany();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
});
afterEach(() => vi.unstubAllGlobals());

describe("Revolut por ID da empresa", () => {
  it("renomear a empresa NÃO desconecta: status da conta segue 'Conectada' e o token é achado", async () => {
    const { revolut } = await seedBankAccounts(s);
    await prisma.company.update({ where: { id: s.companies.pixel.id }, data: { name: "PIXEL ADS LLC (RENOMEADA)" } });
    expect(await getValidAccessToken(s.companies.pixel.id)).toBeTruthy();
    loginAs(s.users.root);
    const status = await (await syncStatus.GET()).json();
    expect(status[revolut.id]).toEqual({ ok: true, label: "Conectada" });
  });

  it("migration 0008: conexão antiga gravada pelo NOME (em outra caixa) vira o ID da empresa; nome sem empresa fica igual", async () => {
    await prisma.company.update({ where: { id: s.companies.pixel.id }, data: { name: "PUBVIEWS OÜ" } });
    await prisma.credential.createMany({
      data: [
        { issuer: "revolut", company: "PubViews OÜ", token: "refresh-velho" },
        { issuer: "revolut", company: "Empresa Que Não Existe", token: "x" },
        { issuer: "wise", company: "PubViews OÜ", token: "outro-banco" }, // só a Revolut muda
      ],
    });
    const sql = readFileSync("prisma/migrations/0008_revolut_credencial_por_id/migration.sql", "utf8");
    await prisma.$executeRawUnsafe(sql);
    const creds = await prisma.credential.findMany({ orderBy: { token: "asc" }, select: { issuer: true, company: true } });
    expect(creds).toEqual([
      { issuer: "wise", company: "PubViews OÜ" },
      { issuer: "revolut", company: s.companies.pixel.id },
      { issuer: "revolut", company: "Empresa Que Não Existe" },
    ]);
  });
});
