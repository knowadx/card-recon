import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, ensureSeedAdmin, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// rate limit simples por IP (reseta no cold start)
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  const e = attempts.get(ip);
  if (e && now < e.resetAt) {
    if (e.count >= 10) return Response.json({ error: "Muitas tentativas. Aguarde 15 min." }, { status: 429 });
    e.count++;
  } else {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }

  await ensureSeedAdmin();

  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return Response.json({ error: "Email e senha obrigatórios" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !user.isActive || !verifyPassword(String(password), user.passwordHash)) {
    return Response.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  attempts.delete(ip);

  const rawNext = request.nextUrl.searchParams.get("next") ?? "/";
  const safePath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const res = NextResponse.json({ ok: true, redirect: safePath });
  res.cookies.set(SESSION_COOKIE, signSession(user.id, user.role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
