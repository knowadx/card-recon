import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { JwtRefused, loginConfig, setAccessKeysForTests, verifyAccessJwt } from "@/lib/accessJwt";
import { loginAs, resetRequest, setRequestHeaders, wipe } from "./helpers";

const TEAM = "pixel.cloudflareaccess.com";
const AUD = "aud-do-app";
const ON = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  setAccessKeysForTests(createLocalJWKSet({ keys: [jwk] }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetRequest();
});

function token(claims: Record<string, unknown> = { email: "Pixel@Teste.com" }, opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof JwtRefused ? e.reason : `outro:${(e as Error).message}`;
  }
}

describe("loginConfig", () => {
  it("as duas vazias = desligado; só uma = incompleto; equipe fora do formato = incompleto", () => {
    expect(loginConfig({}).mode).toBe("desligado");
    expect(loginConfig({ ACCESS_TEAM_DOMAIN: TEAM }).mode).toBe("incompleto");
    expect(loginConfig({ ACCESS_AUD: AUD }).mode).toBe("incompleto");
    expect(loginConfig({ ACCESS_TEAM_DOMAIN: "evil.com", ACCESS_AUD: AUD }).mode).toBe("incompleto");
    expect(loginConfig({ ACCESS_TEAM_DOMAIN: `https://${TEAM.toUpperCase()}/`, ACCESS_AUD: AUD })).toEqual({ mode: "ligado", team: TEAM, aud: AUD });
  });
});

describe("verifyAccessJwt", () => {
  const cfg = loginConfig(ON);

  it("JWT válido → e-mail em minúsculas", async () => {
    expect(await verifyAccessJwt(await token(), cfg)).toBe("pixel@teste.com");
  });

  it("recusa: outro app (aud), outra equipe (iss), vencido, sem e-mail, chave de outra pessoa, ausente", async () => {
    expect(await reason(verifyAccessJwt(await token(undefined, { aud: "outro-app" }), cfg))).not.toBe("ok");
    expect(await reason(verifyAccessJwt(await token(undefined, { iss: "https://evil.cloudflareaccess.com" }), cfg))).not.toBe("ok");
    expect(await reason(verifyAccessJwt(await token(undefined, { exp: "-10m" }), cfg))).not.toBe("ok");
    expect(await reason(verifyAccessJwt(await token({ sub: "x" }), cfg))).toBe("SEM_EMAIL");
    expect(await reason(verifyAccessJwt(await token(undefined, { key: otherKey }), cfg))).not.toBe("ok");
    expect(await reason(verifyAccessJwt(null, cfg))).toBe("AUSENTE");
  });

  it("recusa JWT forjado com HS256 (algoritmo fora da lista)", async () => {
    const forged = await new SignJWT({ email: "pixel@teste.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("qualquer-segredo-com-32-bytes-ou-mais!!"));
    expect(await reason(verifyAccessJwt(forged, cfg))).not.toBe("ok");
  });
});

describe("getCurrentUser com o login da Cloudflare", () => {
  it("LIGADO: o JWT conferido identifica o cadastro ativo; cookie antigo sozinho não entra", async () => {
    await wipe();
    const u = await prisma.user.create({ data: { email: "pixel@teste.com" } });
    for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);

    loginAs(u); // cookie antigo válido, mas sem JWT
    expect(await getCurrentUser()).toBeNull();

    setRequestHeaders({ "cf-access-jwt-assertion": await token() });
    expect((await getCurrentUser())?.id).toBe(u.id);
  });

  it("LIGADO: e-mail sem cadastro, cadastro desativado e cabeçalho de e-mail sem JWT = ninguém", async () => {
    await wipe();
    await prisma.user.create({ data: { email: "inativo@teste.com", isActive: false } });
    for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);

    setRequestHeaders({ "cf-access-jwt-assertion": await token({ email: "desconhecido@teste.com" }) });
    expect(await getCurrentUser()).toBeNull();

    setRequestHeaders({ "cf-access-jwt-assertion": await token({ email: "inativo@teste.com" }) });
    expect(await getCurrentUser()).toBeNull();

    setRequestHeaders({ "cf-access-authenticated-user-email": "inativo@teste.com" });
    expect(await getCurrentUser()).toBeNull();
  });

  it("INCOMPLETO fecha: nem JWT válido nem cookie entram", async () => {
    await wipe();
    const u = await prisma.user.create({ data: { email: "pixel@teste.com" } });
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", "");
    loginAs(u);
    setRequestHeaders({ "cf-access-jwt-assertion": await token() });
    expect(await getCurrentUser()).toBeNull();
  });

  it("lê o pedido ANTES de tudo, mesmo sem a Cloudflare configurada (senão o Next pré-monta a página no build com 'sem usuário' — bug do /control)", async () => {
    vi.stubEnv("ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("ACCESS_AUD", "");
    const estado = (globalThis as unknown as { __fakeRequest: { headers: Record<string, string> } }).__fakeRequest;
    const original = estado.headers;
    let leu = false;
    Object.defineProperty(estado, "headers", { get() { leu = true; return original; }, configurable: true });
    try {
      expect(await getCurrentUser()).toBeNull();
      expect(leu).toBe(true);
    } finally {
      Object.defineProperty(estado, "headers", { value: original, writable: true, configurable: true, enumerable: true });
    }
  });

  it("DESLIGADO (Cloudflare não configurada): ninguém entra — nem com JWT válido (o login por cookie foi removido)", async () => {
    await wipe();
    await prisma.user.create({ data: { email: "pixel@teste.com" } });
    vi.stubEnv("ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("ACCESS_AUD", "");
    setRequestHeaders({ "cf-access-jwt-assertion": await token() });
    expect(await getCurrentUser()).toBeNull();
  });
});
