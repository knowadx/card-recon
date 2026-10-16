import { NextRequest, NextResponse } from "next/server";
import { ACCESS_JWT_HEADER, loginConfig, verifyAccessJwt } from "@/lib/accessJwt";

/**
 * Porta de entrada (Next 16: "proxy", antigo middleware). Decide SÓ se o pedido pode seguir;
 * quem é a pessoa e o que ela pode ver ficam em src/lib/auth.ts e src/lib/access.ts (com o banco).
 *
 * Login da Cloudflare (src/lib/accessJwt.ts):
 *   ligado     → só passa quem traz o JWT da Cloudflare conferido. Quem chega sem ele (ex.: pela
 *                URL direta da Vercel) recebe 401/403 — não existe tela de senha.
 *   incompleto → ninguém passa (configuração errada fecha): 503.
 *   desligado  → login antigo: cookie assinado; sem cookie válido vai para /login.
 */

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/recover", "/api/revolut/callback", "/api/meta/callback"];
const COOKIE = "cr_session";

function cookieSecret(): string | null {
  const s = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (s) return s;
  return process.env.NODE_ENV === "production" ? null : "pixelfinance-dev-secret";
}

async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validCookie(token: string | undefined): Promise<boolean> {
  const secret = cookieSecret();
  if (!token || !secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  let payload: string;
  try {
    payload = atob(token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return false;
  }
  if (!safeEqual(token.slice(dot + 1), await hmacHex(secret, payload))) return false;
  const exp = Number(payload.split(".")[2]);
  return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
}

function refuse(request: NextRequest, status: 401 | 403 | 503, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: message }, { status });
  return new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function proxy(request: NextRequest) {
  const cfg = loginConfig();

  if (cfg.mode === "incompleto") return refuse(request, 503, "Login mal configurado (ACCESS_TEAM_DOMAIN/ACCESS_AUD). Ninguém entra até corrigir.");

  if (cfg.mode === "ligado") {
    try {
      await verifyAccessJwt(request.headers.get(ACCESS_JWT_HEADER), cfg);
      return NextResponse.next();
    } catch {
      return refuse(request, 403, "Acesse o PixelFinance pelo endereço oficial (login pela Cloudflare).");
    }
  }

  // desligado: login antigo por cookie
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (await validCookie(request.cookies.get(COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
