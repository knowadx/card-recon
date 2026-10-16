import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as categories from "@/app/api/categories/route";
import * as syncPeriod from "@/app/api/settings/sync-period/route";
import * as coverage from "@/app/api/coverage/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; role: string };
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "admin@teste.com", role: "admin", passwordHash: "x:y" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
});

const newCategory = (name: string) =>
  categories.POST(req("/api/categories", { method: "POST", json: { type: "managerial", name } }));

describe("configuração do app: superadmin e admins alteram, member só lê", () => {
  it("admin da equipe cria categoria", async () => {
    loginAs(admin);
    expect((await newCategory("Nova do admin")).status).toBe(201);
  });

  it("member lê, mas não cria (403) e nada é gravado", async () => {
    loginAs(s.users.pixel);
    expect((await categories.GET(req("/api/categories"))).status).toBe(200);
    expect((await newCategory("Tentativa do member")).status).toBe(403);
    expect(await prisma.category.count({ where: { name: "Tentativa do member" } })).toBe(0);
  });

  it("período de sincronização: admin altera, member não", async () => {
    const post = () => syncPeriod.POST(req("/api/settings/sync-period", { method: "POST", json: { start: "2026-10-01", end: "2026-10-31" } }));
    loginAs(s.users.pixel);
    expect((await post()).status).toBe(403);
    loginAs(admin);
    expect((await post()).status).not.toBe(403);
  });

  it("diagnóstico interno (/coverage) continua só do superadmin", async () => {
    loginAs(admin);
    expect((await coverage.GET()).status).toBe(403);
  });
});
