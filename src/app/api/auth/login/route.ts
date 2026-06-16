import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomBytes } from "crypto";

// Simple in-memory rate limiter (resets on cold start)
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

async function computeHmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const correct = process.env.APP_PASSWORD;
  if (!correct) {
    return Response.json({ error: "Servidor não configurado" }, { status: 503 });
  }

  // Rate limiting
  const ip = getIp(request);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= MAX_ATTEMPTS) {
      return Response.json({ error: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });
    }
    entry.count++;
  } else {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }

  const { password } = await request.json();

  // Timing-safe comparison
  let match = false;
  try {
    const a = Buffer.from(password ?? "");
    const b = Buffer.from(correct);
    if (a.length === b.length) match = timingSafeEqual(a, b);
  } catch {
    match = false;
  }

  if (!match) {
    return Response.json({ error: "Senha incorreta" }, { status: 401 });
  }

  attempts.delete(ip);

  const sessionToken = randomBytes(32).toString("hex");
  const mac = await computeHmac(correct, sessionToken);

  const rawNext = request.nextUrl.searchParams.get("next") ?? "/";
  const safePath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const response = NextResponse.redirect(new URL(safePath, request.url));

  const cookieOpts = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30, path: "/" };
  response.cookies.set("session", sessionToken, cookieOpts);
  response.cookies.set("session_mac", mac, cookieOpts);

  return response;
}
