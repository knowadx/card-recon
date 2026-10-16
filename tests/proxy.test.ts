import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { proxy } from "@/proxy";
import { setAccessKeysForTests } from "@/lib/accessJwt";

const TEAM = "pixel.cloudflareaccess.com";
const AUD = "aud-do-app";
let key: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  key = kp.privateKey;
  setAccessKeysForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" }] }));
});
afterEach(() => vi.unstubAllEnvs());

const jwt = () =>
  new SignJWT({ email: "pixel@teste.com" }).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`).setAudience(AUD).setExpirationTime("5m").sign(key);

const call = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://app.exemplo.com${path}`, { headers }));

describe("proxy — sem a Cloudflare configurada ninguém entra (o login antigo por cookie foi removido)", () => {
  it("DESLIGADO: 503 pra tudo — página, API, /login e até com o cookie antigo", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("ACCESS_AUD", "");
    for (const path of ["/transactions", "/api/accounts", "/login"]) expect((await call(path)).status).toBe(503);
    expect((await call("/api/accounts", { cookie: "cr_session=qualquer.coisa" })).status).toBe(503);
  });
});

describe("proxy — login da Cloudflare", () => {
  it("LIGADO: com JWT conferido passa; sem JWT = 403, mesmo com o cookie do login antigo", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", AUD);
    expect((await call("/transactions", { "cf-access-jwt-assertion": await jwt() })).headers.get("x-middleware-next")).toBe("1");
    expect((await call("/transactions", { cookie: "cr_session=qualquer.coisa" })).status).toBe(403);
    expect((await call("/api/accounts")).status).toBe(403);
    expect((await call("/login")).status).toBe(403);
  });

  it("INCOMPLETO: 503 pra todo mundo", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", "");
    expect((await call("/transactions", { "cf-access-jwt-assertion": await jwt() })).status).toBe(503);
  });
});

describe("proxy — /api/health (deploy/Docker)", () => {
  it("passa em qualquer modo, mas só o caminho exato (nada de /api/healthX nem subcaminho)", async () => {
    expect((await call("/api/health")).headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", AUD);
    expect((await call("/api/health")).headers.get("x-middleware-next")).toBe("1");
    expect((await call("/api/healthz")).status).toBe(403);
    expect((await call("/api/health/../accounts")).status).toBe(403);
    vi.stubEnv("ACCESS_AUD", "");
    expect((await call("/api/health")).headers.get("x-middleware-next")).toBe("1");
  });
});
