import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { prisma } from "@/lib/db";
import { setAccessKeysForTests } from "@/lib/accessJwt";
import ControlLayout from "@/app/control/layout";
import { loginAs, resetRequest, setRequestHeaders, wipe } from "./helpers";

// A tela /control com o login da Cloudflare (como em produção). Bug de 2026-10-16: a guarda lia o
// cookie de sessão antigo, que não existe com o Access ligado → todo mundo voltava pro Dashboard.
const TEAM = "pixel.cloudflareaccess.com";
const AUD = "aud-do-app";
let privateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  setAccessKeysForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" }] }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRequest();
});

const jwt = (email: string) =>
  new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime("5m").sign(privateKey);

async function abre(): Promise<"abriu" | "voltou pro Dashboard"> {
  try {
    await ControlLayout({ children: null });
    return "abriu";
  } catch (e) {
    if (String((e as { digest?: string }).digest ?? e).includes("NEXT_REDIRECT")) return "voltou pro Dashboard";
    throw e;
  }
}

describe("/control com o login da Cloudflare (Access ligado)", () => {
  it("superadmin e admin abrem; member e sem login voltam pro Dashboard", async () => {
    await wipe();
    const mk = (email: string, role: string) => prisma.user.create({ data: { email, role } });
    await mk("dono@teste.com", "superadmin");
    await mk("admin@teste.com", "admin");
    await mk("membro@teste.com", "member");
    vi.stubEnv("ACCESS_TEAM_DOMAIN", TEAM);
    vi.stubEnv("ACCESS_AUD", AUD);

    setRequestHeaders({ "cf-access-jwt-assertion": await jwt("dono@teste.com") });
    expect(await abre()).toBe("abriu");
    setRequestHeaders({ "cf-access-jwt-assertion": await jwt("admin@teste.com") });
    expect(await abre()).toBe("abriu");
    setRequestHeaders({ "cf-access-jwt-assertion": await jwt("membro@teste.com") });
    expect(await abre()).toBe("voltou pro Dashboard");
    setRequestHeaders({});
    expect(await abre()).toBe("voltou pro Dashboard");
  });

  it("sem a Cloudflare configurada nem o superadmin abre (o login antigo por cookie foi removido)", async () => {
    await wipe();
    await prisma.user.create({ data: { email: "dono@teste.com", role: "superadmin" } });
    vi.stubEnv("ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("ACCESS_AUD", "");
    setRequestHeaders({ "cf-access-jwt-assertion": await jwt("dono@teste.com") });
    expect(await abre()).toBe("voltou pro Dashboard");
  });
});
