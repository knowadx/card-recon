import type { PrismaClient } from "@/generated/prisma/client";

const WISE_BASE = "https://api.wise.com";

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const clientId = process.env.WISE_CLIENT_ID!;
  const clientSecret = process.env.WISE_CLIENT_SECRET!;
  const redirectUri = process.env.WISE_REDIRECT_URI!;

  const res = await fetch(`${WISE_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise token exchange failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const clientId = process.env.WISE_CLIENT_ID!;
  const clientSecret = process.env.WISE_CLIENT_SECRET!;

  const res = await fetch(`${WISE_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise token refresh failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function getValidWiseToken(prisma: PrismaClient): Promise<string> {
  const [atRow, rtRow, expRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "wise_access_token" } }),
    prisma.setting.findUnique({ where: { key: "wise_refresh_token" } }),
    prisma.setting.findUnique({ where: { key: "wise_access_token_exp" } }),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const exp = expRow ? parseInt(expRow.value) : 0;

  if (atRow && exp > now + 60) return atRow.value;
  if (!rtRow) throw new Error("No Wise refresh token stored. Complete OAuth first.");

  const tokens = await refreshAccessToken(rtRow.value);
  const newExp = now + (tokens.expires_in ?? 43200);

  await prisma.setting.upsert({ where: { key: "wise_access_token" }, create: { key: "wise_access_token", value: tokens.access_token }, update: { value: tokens.access_token } });
  await prisma.setting.upsert({ where: { key: "wise_access_token_exp" }, create: { key: "wise_access_token_exp", value: String(newExp) }, update: { value: String(newExp) } });
  if (tokens.refresh_token) {
    await prisma.setting.upsert({ where: { key: "wise_refresh_token" }, create: { key: "wise_refresh_token", value: tokens.refresh_token }, update: { value: tokens.refresh_token } });
  }

  return tokens.access_token;
}

export { WISE_BASE };
