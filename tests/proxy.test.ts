import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { proxy } from "@/proxy";
import { setAccessKeysForTests } from "@/lib/accessJwt";
import { signSession } from "@/lib/auth";

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

describe("proxy — login antigo (desligado)", () => {
  it("página sem cookie vai pro /login; API sem cookie = 401; cookie válido passa; /login é público", async () => {
    const page = await call("/transactions");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Ftransactions");
    expect((await call("/api/accounts")).status).toBe(401);
    const ok = await call("/api/accounts", { cookie: `cr_session=${signSession("u1", "member")}` });
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect((await call("/login")).headers.get("x-middleware-next")).toBe("1");
  });

  it("cookie com assinatura adulterada não passa", async () => {
    const forged = signSession("u1", "member").replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    expect((await call("/api/accounts", { cookie: `cr_session=${forged}` })).status).toBe(401);
  });

  it("em produção sem SESSION_SECRET ninguém entra (antes caía num segredo fixo)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("APP_PASSWORD", "");
    const devToken = signSessionWith("pixelfinance-dev-secret");
    expect((await call("/api/accounts", { cookie: `cr_session=${devToken}` })).status).toBe(401);
  });
});

describe("proxy — login da Cloudflare", () => {
  it("LIGADO: com JWT conferido passa; sem JWT (ex.: URL direta da Vercel) = 403, mesmo com cookie antigo", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", AUD);
    expect((await call("/transactions", { "cf-access-jwt-assertion": await jwt() })).headers.get("x-middleware-next")).toBe("1");
    expect((await call("/transactions", { cookie: `cr_session=${signSession("u1", "member")}` })).status).toBe(403);
    expect((await call("/api/accounts")).status).toBe(403);
    expect((await call("/login")).status).toBe(403);
  });

  it("INCOMPLETO: 503 pra todo mundo", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", "");
    expect((await call("/transactions", { "cf-access-jwt-assertion": await jwt() })).status).toBe(503);
  });
});

// cookie assinado com um segredo específico (para simular o segredo fixo antigo)
import { createHmac } from "crypto";
function signSessionWith(secret: string) {
  const payload = `u1.member.${Math.floor(Date.now() / 1000) + 3600}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

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
