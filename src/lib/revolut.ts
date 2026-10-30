import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./db";

/**
 * Revolut Business — MULTI-EMPRESA. Cada empresa tem seu próprio app (client_id) e
 * consentimento OAuth; o MESMO certificado X.509 (revolut_public.cer) é subido em
 * todas. A chave privada (REVOLUT_PRIVATE_KEY ou revolut_private.pem) é compartilhada.
 *
 * Credencial por empresa: Credential(issuer="revolut", company = ID da empresa no PixelFinance),
 *   token = refresh_token, secrets = { clientId, redirectUri, accessToken, accessExp }.
 * ID, nunca o NOME: em 2026-10 as empresas foram renomeadas (PubViews OÜ → PUBVIEWS OÜ) e a conexão
 * guardada pelo nome sumiu pro sync e pra tela (migration 0008 converteu as antigas).
 */

export const REVOLUT_BASE = process.env.REVOLUT_API_BASE || "https://b2b.revolut.com/api/1.0";

function getPrivateKey(): string {
  if (process.env.REVOLUT_PRIVATE_KEY) return process.env.REVOLUT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const keyPath = process.env.REVOLUT_PRIVATE_KEY_PATH ?? "./revolut_private.pem";
  // caminho só no dev local; em produção a chave vem pelo CONTEÚDO (REVOLUT_PRIVATE_KEY).
  // turbopackIgnore: sem isso o Next empacota o projeto inteiro no build standalone.
  return readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), keyPath), "utf8");
}

function base64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function parseSecrets(s: string | null): Record<string, string> {
  if (!s) return {};
  try { return JSON.parse(s) as Record<string, string>; } catch { return {}; }
}

export function buildJwt(clientId: string, redirectUri: string): string {
  const issuer = new URL(redirectUri).hostname; // Revolut exige o hostname do redirect
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: issuer, sub: clientId, aud: "https://revolut.com", iat: now, exp: now + 3600, jti: randomUUID() }));
  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  return `${signing}.${base64url(sign.sign(getPrivateKey()))}`;
}

export function authorizeUrl(clientId: string, companyId: string, redirectUri: string): string {
  const u = new URL("https://business.revolut.com/app-confirm");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "READ");
  u.searchParams.set("state", companyId);
  return u.toString();
}

async function tokenRequest(clientId: string, redirectUri: string, params: Record<string, string>) {
  const res = await fetch(`${REVOLUT_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: buildJwt(clientId, redirectUri),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Revolut token ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

/** Registra empresa (ID) + client_id + redirect antes do consentimento. */
export async function registerCompany(companyId: string, clientId: string, redirectUri: string): Promise<void> {
  await prisma.credential.upsert({
    where: { issuer_company: { issuer: "revolut", company: companyId } },
    update: { secrets: JSON.stringify({ clientId, redirectUri }) },
    create: { issuer: "revolut", company: companyId, token: "", secrets: JSON.stringify({ clientId, redirectUri }) },
  });
}

/** Troca o code pelo refresh+access token e grava na Credential da empresa. */
export async function completeConsent(companyId: string, code: string): Promise<void> {
  const cred = await prisma.credential.findUnique({ where: { issuer_company: { issuer: "revolut", company: companyId } } });
  const s = cred ? parseSecrets(cred.secrets) : {};
  if (!s.clientId || !s.redirectUri) throw new Error("empresa sem client_id/redirect (use /api/revolut/auth primeiro)");
  const t = await tokenRequest(s.clientId, s.redirectUri, { grant_type: "authorization_code", code, redirect_uri: s.redirectUri });
  const exp = Math.floor(Date.now() / 1000) + (t.expires_in ?? 1800);
  await prisma.credential.update({
    where: { issuer_company: { issuer: "revolut", company: companyId } },
    data: { token: t.refresh_token ?? "", secrets: JSON.stringify({ clientId: s.clientId, redirectUri: s.redirectUri, accessToken: t.access_token, accessExp: exp }) },
  });
}

/** Access token válido da empresa (ID; refresh se expirado). */
export async function getValidAccessToken(companyId: string): Promise<string> {
  const cred = await prisma.credential.findUnique({ where: { issuer_company: { issuer: "revolut", company: companyId } } });
  if (!cred) throw new Error("Revolut desta empresa não cadastrado");
  const s = parseSecrets(cred.secrets);
  const now = Math.floor(Date.now() / 1000);
  if (s.accessToken && s.accessExp && Number(s.accessExp) > now + 60) return s.accessToken;
  if (!cred.token) throw new Error("Revolut desta empresa sem consentimento");
  const t = await tokenRequest(s.clientId, s.redirectUri, { grant_type: "refresh_token", refresh_token: cred.token });
  const exp = now + (t.expires_in ?? 1800);
  await prisma.credential.update({
    where: { issuer_company: { issuer: "revolut", company: companyId } },
    data: { token: t.refresh_token ?? cred.token, secrets: JSON.stringify({ clientId: s.clientId, redirectUri: s.redirectUri, accessToken: t.access_token, accessExp: exp }) },
  });
  return t.access_token;
}

/** Empresas (IDs) com a Revolut já consentida (têm refresh token). */
export async function connectedRevolutCompanies(): Promise<string[]> {
  const rows = await prisma.credential.findMany({ where: { issuer: "revolut", isActive: true, NOT: { token: "" } }, select: { company: true } });
  return rows.map((r) => r.company);
}
