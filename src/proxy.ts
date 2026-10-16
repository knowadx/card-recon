import { NextRequest, NextResponse } from "next/server";
import { ACCESS_JWT_HEADER, loginConfig, verifyAccessJwt } from "@/lib/accessJwt";

/**
 * Porta de entrada (Next 16: "proxy", antigo middleware). Decide SÓ se o pedido pode seguir;
 * quem é a pessoa e o que ela pode ver ficam em src/lib/auth.ts e src/lib/access.ts (com o banco).
 *
 * Login SÓ pela Cloudflare (src/lib/accessJwt.ts) — o login antigo por cookie foi removido:
 *   ligado            → só passa quem traz o JWT da Cloudflare conferido; sem ele, 403.
 *   desligado/incompleto → ninguém passa (falta configurar ou está errado): 503.
 */

function refuse(request: NextRequest, status: 403 | 503, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: message }, { status });
  return new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** Saúde para o deploy/Docker: sem dado nenhum, passa sempre (ver api/health). */
const HEALTH_PATH = "/api/health";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === HEALTH_PATH) return NextResponse.next();
  const cfg = loginConfig();

  if (cfg.mode !== "ligado") {
    return refuse(request, 503, "Login da Cloudflare não configurado (ACCESS_TEAM_DOMAIN/ACCESS_AUD). Ninguém entra até configurar.");
  }
  try {
    await verifyAccessJwt(request.headers.get(ACCESS_JWT_HEADER), cfg);
    return NextResponse.next();
  } catch {
    return refuse(request, 403, "Acesse o PixelFinance pelo endereço oficial (login pela Cloudflare).");
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
