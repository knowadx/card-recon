import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import * as operations from "@/app/api/operations/route";
import * as metaAuth from "@/app/api/meta/auth/route";
import * as metaDisconnect from "@/app/api/meta/disconnect/route";
import * as users from "@/app/api/users/route";
import * as userById from "@/app/api/users/[id]/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Operação mora SÓ no split (decisão do dono em 2026-10-30): a lista é GLOBAL (como categoria) e
 * quem MANDA numa operação — Meta, remover, conceder acesso — é quem é membro dela (ou o superadmin).
 * Antes a holding dona dava isso; sem holding dona, admin de holding não manda em operação alheia.
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let opOutro: { id: string };
let adminPixel: { id: string; email: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  opOutro = await prisma.operation.create({ data: { name: "Op Outro" } });
  adminPixel = await prisma.user.create({ data: { email: "admin-pixel@teste.com", role: "admin" } });
  await prisma.membership.create({ data: { userId: adminPixel.id, holdingId: s.holdings.pixel.id } });
  await prisma.credential.create({
    data: { issuer: "meta", company: "Op Pixel", operationId: s.operations.pixel.id, token: "tok-meta", secrets: JSON.stringify({ metaUserName: "Perfil Pixel" }) },
  });
});
afterEach(() => vi.unstubAllEnvs());

const lista = async () => (await operations.GET()).json() as Promise<Array<Record<string, unknown>>>;

describe("GET /api/operations — lista global", () => {
  it("todo mundo logado vê TODAS as operações; o Meta (perfil, conexão) só sai pra quem opera", async () => {
    loginAs(s.users.semAcesso);
    const sem = await lista();
    expect(sem.map((o) => o.name)).toEqual(["Op Outro", "Op Pixel"]);
    expect(sem.every((o) => o.podeGerenciar === false && !("metaConnected" in o) && !("metaProfile" in o))).toBe(true);
    expect(JSON.stringify(sem)).not.toContain("Perfil Pixel");

    loginAs(s.users.operador);
    const op = await lista();
    expect(op.find((o) => o.name === "Op Pixel")).toMatchObject({ podeGerenciar: true, metaConnected: true, metaProfile: "Perfil Pixel" });
    expect(op.find((o) => o.name === "Op Outro")).toMatchObject({ podeGerenciar: false });

    loginAs(s.users.root);
    expect((await lista()).every((o) => o.podeGerenciar === true)).toBe(true);

    loginAs(null);
    expect((await operations.GET()).status).toBe(401);
  });
});

describe("POST/DELETE /api/operations", () => {
  const criar = (json: Record<string, unknown>) => operations.POST(req("/api/operations", { method: "POST", json }));
  const apagar = (id: string) => operations.DELETE(req(`/api/operations?id=${id}`, { method: "DELETE" }));

  it("admin cria sem holding e vira membro (é o que deixa ele conectar o Meta e conceder); membro comum = 403", async () => {
    loginAs(s.users.pixel);
    expect((await criar({ name: "Op Nova" })).status).toBe(403);
    loginAs(adminPixel);
    const res = await criar({ name: "Op Nova", holdingId: s.holdings.pixel.id }); // holding vinda do pedido é ignorada
    expect(res.status).toBe(201);
    const nova = await res.json();
    expect(await prisma.operationMembership.count({ where: { operationId: nova.id, userId: adminPixel.id } })).toBe(1);
    expect((await lista()).find((o) => o.id === nova.id)).toMatchObject({ podeGerenciar: true });
  });

  it("admin de holding NÃO apaga operação que não opera (levaria o Meta e os acessos); quem opera apaga e os splits ficam sem operação", async () => {
    loginAs(adminPixel);
    expect((await apagar(s.operations.pixel.id)).status).toBe(403);
    expect(await prisma.operation.count({ where: { id: s.operations.pixel.id } })).toBe(1);

    await prisma.operationMembership.create({ data: { userId: adminPixel.id, operationId: s.operations.pixel.id } });
    expect((await apagar(s.operations.pixel.id)).status).toBe(200);
    expect(await prisma.operation.count({ where: { id: s.operations.pixel.id } })).toBe(0);
    expect(await prisma.credential.count({ where: { issuer: "meta" } })).toBe(0);
    const split = await prisma.transactionSplit.findFirstOrThrow({ where: { transactionId: s.transactions.pixel.id } });
    expect(split).toMatchObject({ amount: -100, operationId: null });
  });
});

describe("Meta da operação = de quem opera", () => {
  const nreq = (path: string) => new NextRequest(`https://app.exemplo.com${path}`);

  it("conectar: membro da holding (mesmo admin) sem ser da operação = 403; membro da operação abre o login", async () => {
    vi.stubEnv("META_APP_ID", "123");
    for (const u of [s.users.pixel, adminPixel]) {
      loginAs(u);
      expect((await metaAuth.GET(nreq(`/api/meta/auth?operationId=${s.operations.pixel.id}`))).status).toBe(403);
    }
    loginAs(s.users.operador);
    const ok = await metaAuth.GET(nreq(`/api/meta/auth?operationId=${s.operations.pixel.id}`));
    expect(ok.status).toBe(307);
    expect((await metaAuth.GET(nreq(`/api/meta/auth?operationId=${opOutro.id}`))).status).toBe(403);
  });

  it("desconectar: admin de holding sem ser da operação = 403 e a credencial fica", async () => {
    const desconectar = () => metaDisconnect.POST(req("/api/meta/disconnect", { method: "POST", json: { operationId: s.operations.pixel.id } }));
    loginAs(adminPixel);
    expect((await desconectar()).status).toBe(403);
    expect(await prisma.credential.count({ where: { issuer: "meta" } })).toBe(1);
    loginAs(s.users.operador);
    expect((await desconectar()).status).toBe(200);
    expect(await prisma.credential.count({ where: { issuer: "meta" } })).toBe(0);
  });
});

describe("conceder acesso a operação = só quem opera", () => {
  it("admin concede só as operações que opera — as outras do pedido são ignoradas, ao criar e ao editar", async () => {
    await prisma.operationMembership.create({ data: { userId: adminPixel.id, operationId: s.operations.pixel.id } });
    loginAs(adminPixel);
    const res = await users.POST(req("/api/users", { method: "POST", json: { email: "novo@teste.com", operationIds: [s.operations.pixel.id, opOutro.id] } }));
    expect(res.status).toBe(200);
    const novo = await prisma.user.findUniqueOrThrow({ where: { email: "novo@teste.com" }, include: { operationMemberships: true } });
    expect(novo.operationMemberships.map((m) => m.operationId)).toEqual([s.operations.pixel.id]);

    // o operador está na equipe do admin (membro de operação que ele opera): tentar dar a Op Outro não pega
    expect((await userById.PATCH(req("/x", { method: "PATCH", json: { operationIds: [s.operations.pixel.id, opOutro.id] } }), params({ id: s.users.operador.id }))).status).toBe(200);
    const ops = await prisma.operationMembership.findMany({ where: { userId: s.users.operador.id }, select: { operationId: true } });
    expect(ops.map((m) => m.operationId)).toEqual([s.operations.pixel.id]);
  });

  it("admin que não opera nenhuma operação não concede nenhuma", async () => {
    loginAs(adminPixel);
    await users.POST(req("/api/users", { method: "POST", json: { email: "novo@teste.com", holdingIds: [s.holdings.pixel.id], operationIds: [s.operations.pixel.id] } }));
    const novo = await prisma.user.findUniqueOrThrow({ where: { email: "novo@teste.com" }, include: { operationMemberships: true, memberships: true } });
    expect(novo.memberships.map((m) => m.holdingId)).toEqual([s.holdings.pixel.id]);
    expect(novo.operationMemberships).toEqual([]);
  });
});
