import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  AccessError,
  assertAccount,
  assertCompany,
  assertHolding,
  assertTransaction,
  assertTransactions,
  companyScope,
  requireSuperadmin,
  requireUser,
} from "@/lib/access";
import { loginAs, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
beforeAll(async () => {
  s = await seedTwoGroups();
});
beforeEach(() => resetRequest());

async function statusOf(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AccessError) return e.status;
    throw e;
  }
}

describe("requireUser / requireSuperadmin", () => {
  it("deslogado = 401", async () => {
    loginAs(null);
    expect(await statusOf(requireUser())).toBe(401);
  });

  it("usuário desativado = 401, mesmo com JWT válido", async () => {
    const u = await prisma.user.create({ data: { email: "inativo@teste.com", isActive: false } });
    loginAs(u);
    expect(await statusOf(requireUser())).toBe(401);
  });

  it("o papel vem do banco, não do JWT: JWT dizendo superadmin não promove ninguém", async () => {
    loginAs(s.users.pixel, { role: "superadmin" });
    expect(await statusOf(requireSuperadmin())).toBe(403);
  });

  it("superadmin passa", async () => {
    loginAs(s.users.root);
    expect(await statusOf(requireSuperadmin())).toBe("ok");
  });
});

describe("um grupo não enxerga o outro", () => {
  it("membro da Pixel: vê o que é da Pixel, recebe 404 no que é do outro grupo", async () => {
    const u = s.users.pixel;
    expect(await statusOf(assertAccount(u, s.accounts.pixel.id))).toBe("ok");
    expect(await statusOf(assertAccount(u, s.accounts.outro.id))).toBe(404);
    expect(await statusOf(assertTransaction(u, s.transactions.pixel.id))).toBe("ok");
    expect(await statusOf(assertTransaction(u, s.transactions.outro.id))).toBe(404);
    expect(await statusOf(assertCompany(u, s.companies.pixel.id))).toBe("ok");
    expect(await statusOf(assertCompany(u, s.companies.outro.id))).toBe(404);
    expect(await statusOf(assertHolding(u, s.holdings.pixel.id))).toBe("ok");
    expect(await statusOf(assertHolding(u, s.holdings.outro.id))).toBe(404);
  });

  it("membro do outro grupo: o espelho", async () => {
    const u = s.users.outro;
    expect(await statusOf(assertAccount(u, s.accounts.pixel.id))).toBe(404);
    expect(await statusOf(assertTransaction(u, s.transactions.pixel.id))).toBe(404);
    expect(await statusOf(assertCompany(u, s.companies.pixel.id))).toBe(404);
  });

  it("lote com UMA transação de fora = recusa o lote inteiro", async () => {
    const u = s.users.pixel;
    expect(await statusOf(assertTransactions(u, [s.transactions.pixel.id]))).toBe("ok");
    expect(await statusOf(assertTransactions(u, [s.transactions.pixel.id, s.transactions.outro.id]))).toBe(404);
  });

  it("membro só de operação: vê a conta/transação/empresa da operação, nada do outro grupo, e não cria em holding", async () => {
    const u = s.users.operador;
    expect(await statusOf(assertAccount(u, s.accounts.pixel.id))).toBe("ok");
    expect(await statusOf(assertTransaction(u, s.transactions.pixel.id))).toBe("ok");
    expect(await statusOf(assertCompany(u, s.companies.pixel.id))).toBe("ok");
    expect(await statusOf(assertAccount(u, s.accounts.outro.id))).toBe(404);
    expect(await statusOf(assertHolding(u, s.holdings.pixel.id))).toBe(404);
  });

  it("logado sem vínculo nenhum não vê nada", async () => {
    const u = s.users.semAcesso;
    expect(await statusOf(assertAccount(u, s.accounts.pixel.id))).toBe(404);
    expect(await statusOf(assertTransaction(u, s.transactions.pixel.id))).toBe(404);
    const companies = await prisma.company.findMany({ where: await companyScope(u) });
    expect(companies).toHaveLength(0);
  });

  it("superadmin vê os dois grupos", async () => {
    const u = s.users.root;
    expect(await statusOf(assertAccount(u, s.accounts.outro.id))).toBe("ok");
    expect(await statusOf(assertTransaction(u, s.transactions.pixel.id))).toBe("ok");
    expect(await statusOf(assertHolding(u, s.holdings.outro.id))).toBe("ok");
  });
});

describe("id vazio ou ausente nunca passa (o Prisma ignoraria o filtro { id: undefined })", () => {
  it("todas as checagens recusam undefined, vazio e não-texto, mesmo para quem vê registros", async () => {
    const u = s.users.pixel;
    for (const bad of [undefined, "", "   ", 123, null] as unknown as string[]) {
      expect(await statusOf(assertAccount(u, bad))).toBe(404);
      expect(await statusOf(assertTransaction(u, bad))).toBe(404);
      expect(await statusOf(assertTransactions(u, [s.transactions.pixel.id, bad]))).toBe(404);
      expect(await statusOf(assertCompany(u, bad))).toBe(404);
      expect(await statusOf(assertHolding(u, bad))).toBe(404);
    }
  });
});
