import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { NO_OWN_TOKEN_MESSAGE, resolveBankToken } from "@/lib/credentials";
import * as syncMercury from "@/app/api/sync/mercury/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let authHeaders: string[];

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  // credencial cadastrada de OUTRO grupo + chave global no ambiente
  await prisma.credential.create({ data: { issuer: "mercury", company: s.companies.outro.name, token: "tok-outro", isActive: true } });
  vi.stubEnv("MERCURY_API_KEY", "tok-global");
  authHeaders = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    authHeaders.push(h.get("authorization") ?? "");
    return new Response(JSON.stringify({ transactions: [], cards: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sync = (accountId: string) =>
  syncMercury.POST(req("/api/sync/mercury", { method: "POST", json: { accountId, mercuryAccountId: "conta-no-banco-do-outro-grupo", from: "2026-10-01" } }));

describe("resolveBankToken", () => {
  it("sem allowGlobal: só token da conta ou credencial da PRÓPRIA empresa", async () => {
    const acc = { apiToken: null, company: { name: s.companies.pixel.name } };
    expect(await resolveBankToken("mercury", acc, { allowGlobal: false })).toBeNull();
    expect(await resolveBankToken("mercury", { ...acc, apiToken: "tok-conta" }, { allowGlobal: false })).toBe("tok-conta");
    await prisma.credential.create({ data: { issuer: "mercury", company: s.companies.pixel.name, token: "tok-pixel", isActive: true } });
    expect(await resolveBankToken("mercury", acc, { allowGlobal: false })).toBe("tok-pixel");
  });

  it("com allowGlobal (superadmin): mantém os legados de hoje", async () => {
    const acc = { apiToken: null, company: { name: s.companies.pixel.name } };
    expect(await resolveBankToken("mercury", acc, { allowGlobal: true })).toBe("tok-outro");
  });
});

describe("sync/mercury não usa credencial de outro grupo", () => {
  it("membro da Pixel sem credencial própria: recusa com aviso e NÃO chama o banco", async () => {
    loginAs(s.users.pixel);
    const res = await sync(s.accounts.pixel.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(NO_OWN_TOKEN_MESSAGE);
    expect(authHeaders).toEqual([]);
  });

  it("membro com token na própria conta: usa SÓ esse token", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "tok-da-conta-pixel" } });
    loginAs(s.users.pixel);
    expect((await sync(s.accounts.pixel.id)).status).toBe(200);
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(new Set(authHeaders)).toEqual(new Set(["Bearer tok-da-conta-pixel"]));
  });

  it("superadmin continua podendo usar os legados (comportamento de hoje)", async () => {
    loginAs(s.users.root);
    expect((await sync(s.accounts.pixel.id)).status).toBe(200);
    expect(authHeaders.every((h) => h === "Bearer tok-outro")).toBe(true);
  });
});
