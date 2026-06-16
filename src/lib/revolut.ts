import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import type { PrismaClient } from "@/generated/prisma/client";

const REVOLUT_BASE = "https://b2b.revolut.com/api/1.0";

function getPrivateKey(): string {
  if (process.env.REVOLUT_PRIVATE_KEY) {
    return process.env.REVOLUT_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  const keyPath = process.env.REVOLUT_PRIVATE_KEY_PATH ?? "./revolut_private.pem";
  return readFileSync(path.resolve(process.cwd(), keyPath), "utf8");
}

function base64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function buildJwt(): string {
  const clientId = process.env.REVOLUT_CLIENT_ID!;
  const redirectUri = process.env.REVOLUT_REDIRECT_URI!;
  const issuer = new URL(redirectUri).hostname; // Revolut expects just the hostname, e.g. "localhost"

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: issuer,
      sub: clientId,
      aud: "https://revolut.com",
      iat: now,
      exp: now + 3600,
      jti: randomUUID(),
    })
  );

  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  const sig = base64url(sign.sign(getPrivateKey()));
  return `${signing}.${sig}`;
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; token_type: string; expires_in: number }> {
  const jwt = buildJwt();
  const redirectUri = process.env.REVOLUT_REDIRECT_URI!;

  const res = await fetch(`${REVOLUT_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: jwt,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Revolut token exchange failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const jwt = buildJwt();

  const res = await fetch(`${REVOLUT_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Revolut token refresh failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function getValidAccessToken(prisma: PrismaClient): Promise<string> {
  const [atRow, rtRow, expRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "revolut_access_token" } }),
    prisma.setting.findUnique({ where: { key: "revolut_refresh_token" } }),
    prisma.setting.findUnique({ where: { key: "revolut_access_token_exp" } }),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const exp = expRow ? parseInt(expRow.value) : 0;

  if (atRow && exp > now + 60) return atRow.value;
  if (!rtRow) throw new Error("No Revolut refresh token stored. Complete OAuth first.");

  const tokens = await refreshAccessToken(rtRow.value);
  const newExp = now + (tokens.expires_in ?? 1800);

  await prisma.setting.upsert({ where: { key: "revolut_access_token" }, create: { key: "revolut_access_token", value: tokens.access_token }, update: { value: tokens.access_token } });
  await prisma.setting.upsert({ where: { key: "revolut_access_token_exp" }, create: { key: "revolut_access_token_exp", value: String(newExp) }, update: { value: String(newExp) } });
  if (tokens.refresh_token) {
    await prisma.setting.upsert({ where: { key: "revolut_refresh_token" }, create: { key: "revolut_refresh_token", value: tokens.refresh_token }, update: { value: tokens.refresh_token } });
  }

  return tokens.access_token;
}

export { REVOLUT_BASE };
