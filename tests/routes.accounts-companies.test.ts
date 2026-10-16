import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as accounts from "@/app/api/accounts/route";
import * as account from "@/app/api/accounts/[id]/route";
import * as companies from "@/app/api/companies/route";
import * as company from "@/app/api/companies/[id]/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
});

describe("/api/accounts", () => {
  it("lista só as contas do grupo e nunca devolve o token do banco", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "segredo" } });
    loginAs(s.users.pixel);
    const res = await accounts.GET();
    const body = await res.json();
    expect(body.map((a: { id: string }) => a.id)).toEqual([s.accounts.pixel.id]);
    expect(JSON.stringify(body)).not.toContain("segredo");
    expect(body[0].hasApiToken).toBe(true);
  });

  it("deslogado = 401", async () => {
    loginAs(null);
    expect((await accounts.GET()).status).toBe(401);
  });

  it("não cria conta em empresa de outro grupo", async () => {
    loginAs(s.users.pixel);
    const res = await accounts.POST(req("/api/accounts", { method: "POST", json: { companyId: s.companies.outro.id, bank: "Wise", currency: "USD", name: "invasora" } }));
    expect(res.status).toBe(404);
    expect(await prisma.account.count({ where: { name: "invasora" } })).toBe(0);
  });

  it("member cria conta na própria empresa sem token; com token só admin — e o token nunca volta", async () => {
    loginAs(s.users.pixel);
    const base = { companyId: s.companies.pixel.id, bank: "Wise", currency: "USD" };
    expect((await accounts.POST(req("/api/accounts", { method: "POST", json: { ...base, name: "nova" } }))).status).toBe(201);
    expect((await accounts.POST(req("/api/accounts", { method: "POST", json: { ...base, name: "com token", apiToken: "tok" } }))).status).toBe(403);

    const admin = await prisma.user.create({ data: { email: "admin-cria@teste.com", role: "admin" } });
    await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
    loginAs(admin);
    const res = await accounts.POST(req("/api/accounts", { method: "POST", json: { ...base, name: "com token", apiToken: "tok-secreto" } }));
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toContain("tok-secreto");
  });
});

describe("/api/accounts/[id]", () => {
  it("outro grupo não edita, não mexe no syncConfig e não apaga a conta", async () => {
    loginAs(s.users.outro);
    const id = s.accounts.pixel.id;
    expect((await account.PUT(req(`/api/accounts/${id}`, { method: "PUT", json: { name: "hack" } }), params({ id }))).status).toBe(404);
    expect((await account.PATCH(req(`/api/accounts/${id}`, { method: "PATCH", json: { syncConfig: { x: 1 } } }), params({ id }))).status).toBe(404);
    expect((await account.DELETE(req(`/api/accounts/${id}`, { method: "DELETE" }), params({ id }))).status).toBe(404);
    const still = await prisma.account.findUnique({ where: { id } });
    expect(still?.name).toBe("Mercury Pixel");
    expect(still?.syncConfig).toBeNull();
  });

  it("não move a própria conta para empresa de outro grupo", async () => {
    loginAs(s.users.pixel);
    const id = s.accounts.pixel.id;
    const res = await account.PUT(req(`/api/accounts/${id}`, { method: "PUT", json: { companyId: s.companies.outro.id } }), params({ id }));
    expect(res.status).toBe(404);
    expect((await prisma.account.findUnique({ where: { id } }))?.companyId).toBe(s.companies.pixel.id);
  });

  it("edita a própria conta e a resposta não traz o token", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "segredo" } });
    loginAs(s.users.pixel);
    const id = s.accounts.pixel.id;
    const res = await account.PUT(req(`/api/accounts/${id}`, { method: "PUT", json: { name: "Mercury Pixel 2" } }), params({ id }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("segredo");
  });
});

describe("/api/companies", () => {
  it("lista só as empresas do grupo", async () => {
    loginAs(s.users.outro);
    const body = await (await companies.GET()).json();
    expect(body.map((c: { id: string }) => c.id)).toEqual([s.companies.outro.id]);
  });

  it("não cria empresa em holding de outro grupo, nem sem holding (só o administrador geral)", async () => {
    loginAs(s.users.pixel);
    expect((await companies.POST(req("/api/companies", { method: "POST", json: { name: "X", holdingId: s.holdings.outro.id } }))).status).toBe(404);
    expect((await companies.POST(req("/api/companies", { method: "POST", json: { name: "Y" } }))).status).toBe(403);
    expect((await companies.POST(req("/api/companies", { method: "POST", json: { name: "Z", holdingId: s.holdings.pixel.id } }))).status).toBe(201);
    loginAs(s.users.root);
    expect((await companies.POST(req("/api/companies", { method: "POST", json: { name: "Solta" } }))).status).toBe(201);
  });
});

describe("/api/companies/[id]", () => {
  it("outro grupo não edita nem apaga; dono não leva a empresa pra holding alheia nem tira da holding", async () => {
    const id = s.companies.pixel.id;
    loginAs(s.users.outro);
    expect((await company.PUT(req(`/api/companies/${id}`, { method: "PUT", json: { name: "hack" } }), params({ id }))).status).toBe(404);
    expect((await company.DELETE(req(`/api/companies/${id}`, { method: "DELETE" }), params({ id }))).status).toBe(404);

    loginAs(s.users.pixel);
    expect((await company.PUT(req(`/api/companies/${id}`, { method: "PUT", json: { name: "P", holdingId: s.holdings.outro.id } }), params({ id }))).status).toBe(404);
    expect((await company.PUT(req(`/api/companies/${id}`, { method: "PUT", json: { name: "P", holdingId: null } }), params({ id }))).status).toBe(403);
    expect((await prisma.company.findUnique({ where: { id } }))?.holdingId).toBe(s.holdings.pixel.id);
  });
});

describe("ligar a conta ao banco (token / ids da conta no banco): só superadmin e admins", () => {
  it("member edita o nome da própria conta, mas não o token nem o syncConfig; admin pode", async () => {
    const id = s.accounts.pixel.id;
    loginAs(s.users.pixel); // member
    expect((await account.PUT(req(`/api/accounts/${id}`, { method: "PUT", json: { name: "Só o nome" } }), params({ id }))).status).toBe(200);
    expect((await account.PUT(req(`/api/accounts/${id}`, { method: "PUT", json: { name: "x", apiToken: "tok" } }), params({ id }))).status).toBe(403);
    expect((await account.PATCH(req(`/api/accounts/${id}`, { method: "PATCH", json: { syncConfig: { mercuryAccountId: "conta-de-outro" } } }), params({ id }))).status).toBe(403);
    expect((await prisma.account.findUnique({ where: { id } }))?.syncConfig).toBeNull();

    const admin = await prisma.user.create({ data: { email: "admin-px@teste.com", role: "admin" } });
    await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
    loginAs(admin);
    expect((await account.PATCH(req(`/api/accounts/${id}`, { method: "PATCH", json: { syncConfig: { mercuryAccountId: "m-1" } } }), params({ id }))).status).toBe(200);
  });
});
