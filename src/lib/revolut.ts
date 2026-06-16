import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./db";

/**
 * Revolut Business — OAuth client-assertion JWT (RS256). MULTI-EMPRESA: cada empresa
 * sobe o MESMO certificado X.509 (revolut_public.cer) na sua conta e recebe um
 * client_id próprio. A chave privada (revolut_private.pem) é compartilhada.
 *
 * Fluxo por empresa: /api/revolut/auth?company=X&client_id=Y → consentimento →
 * /callback guarda o refresh token na Credential dessa empresa. O access token é
 * renovado sob demanda e guardado em Credential.secrets.
 */

export const REVOLUT_BASE = process.env.REVOLUT_API_BASE || "https://b2b.revolut.com/api/1.0";

function getPrivateKey(): string {
  if (process.env.REVOLUT_PRIVATE_KEY) return process.env.REVOLUT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const keyPath = process.env.REVOLUT_PRIVATE_KEY_PATH ?? "./revolut_private.pem";
  return readFileSync(path.resolve(process.cwd(), keyPath), "utf8");
}

function base64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * O redirect_uri usado no consentimento, no token exchange e o `iss` do JWT precisam
 * ser o MESMO domínio (exigência do Revolut). Guardamos o redirect por empresa
 * (derivado do domínio real da requisição), então não dependemos de env/localhost.
 */
export function buildJwt(clientId: string, redirectUri: string): string {
  const issuer = new URL(redirectUri).hostname;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ iss: issuer, sub: clientId, aud: "https://revolut.com", iat: now, exp: now + 3600, jti: randomUUID() }),
  );
  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  return `${signing}.${base64url(sign.sign(getPrivateKey()))}`;
}

export function authorizeUrl(clientId: string, company: string, redirectUri: string): string {
  const u = new URL("https://business.revolut.com/app-confirm");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "READ");
  u.searchParams.set("state", company);
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
  });
  if (!res.ok) throw new Error(`Revolut token ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

/** Troca o code pelo refresh+access token e grava na Credential da empresa. */
export async function completeConsent(company: string, code: string): Promise<void> {
  const cred = await prisma.credential.findUnique({ where: { issuer_company: { issuer: "revolut", company } } });
  const s = cred ? parseSecrets(cred.secrets) : {};
  if (!s.clientId || !s.redirectUri) throw new Error(`Empresa "${company}" sem client_id/redirect. Use /api/revolut/auth?company=&client_id= primeiro.`);
  const t = await tokenRequest(s.clientId, s.redirectUri, { grant_type: "authorization_code", code, redirect_uri: s.redirectUri });
  const exp = Math.floor(Date.now() / 1000) + (t.expires_in ?? 1800);
  await prisma.credential.update({
    where: { issuer_company: { issuer: "revolut", company } },
    data: {
      token: t.refresh_token ?? "",
      secrets: JSON.stringify({ clientId: s.clientId, redirectUri: s.redirectUri, accessToken: t.access_token, accessExp: exp }),
    },
  });
}

/** Registra (ou atualiza) a empresa + client_id + redirect (do domínio real). */
export async function registerCompany(company: string, clientId: string, redirectUri: string): Promise<void> {
  await prisma.credential.upsert({
    where: { issuer_company: { issuer: "revolut", company } },
    update: { secrets: JSON.stringify({ clientId, redirectUri }) },
    create: { issuer: "revolut", company, token: "", secrets: JSON.stringify({ clientId, redirectUri }) },
  });
}

/** Access token válido da empresa (renova com refresh se expirado). */
export async function getValidAccessToken(company: string): Promise<string> {
  const cred = await prisma.credential.findUnique({ where: { issuer_company: { issuer: "revolut", company } } });
  if (!cred) throw new Error(`Empresa Revolut "${company}" não cadastrada.`);
  const s = parseSecrets(cred.secrets);
  const now = Math.floor(Date.now() / 1000);
  if (s.accessToken && s.accessExp && Number(s.accessExp) > now + 60) return s.accessToken;
  if (!cred.token) throw new Error(`Revolut "${company}" sem consentimento — abra /api/revolut/auth?company=${encodeURIComponent(company)}.`);
  const t = await tokenRequest(s.clientId, s.redirectUri, { grant_type: "refresh_token", refresh_token: cred.token });
  const exp = now + (t.expires_in ?? 1800);
  await prisma.credential.update({
    where: { issuer_company: { issuer: "revolut", company } },
    data: {
      token: t.refresh_token ?? cred.token,
      secrets: JSON.stringify({ clientId: s.clientId, redirectUri: s.redirectUri, accessToken: t.access_token, accessExp: exp }),
    },
  });
  return t.access_token;
}

function parseSecrets(s: string | null): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}

async function rget<T = unknown>(token: string, p: string): Promise<T> {
  const res = await fetch(`${REVOLUT_BASE}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Revolut ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

export interface RevolutCard {
  id: string;
  last_digits?: string;
  label?: string;
  state?: string;
}

export interface RevolutTransaction {
  id: string;
  type?: string;
  state?: string;
  created_at?: string;
  completed_at?: string;
  merchant?: { name?: string };
  card?: { card_number?: string; last_digits?: string };
  legs?: Array<{ amount?: number; currency?: string; description?: string }>;
}

export async function fetchCards(token: string): Promise<RevolutCard[]> {
  return rget<RevolutCard[]>(token, "/cards");
}

export async function fetchTransactions(token: string, fromISO: string, toISO: string): Promise<RevolutTransaction[]> {
  const out: RevolutTransaction[] = [];
  let to = toISO;
  for (let guard = 0; guard < 50; guard++) {
    const qs = new URLSearchParams({ from: fromISO, to, count: "1000" }).toString();
    const batch = await rget<RevolutTransaction[]>(token, `/transactions?${qs}`);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 1000) break;
    const last = batch[batch.length - 1]?.created_at;
    if (!last || last === to) break;
    to = last;
  }
  return out;
}

export function extractCardLast4(tx: RevolutTransaction): string | null {
  const c = tx.card?.last_digits ?? tx.card?.card_number;
  if (typeof c === "string") {
    const m = c.match(/(\d{4})(?!.*\d)/);
    if (m) return m[1];
  }
  return null;
}
