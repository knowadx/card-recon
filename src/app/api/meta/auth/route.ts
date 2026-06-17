import { NextResponse } from "next/server";
import { metaAuthorizeUrl } from "@/lib/meta";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/meta/auth?operationId=... — abre o Facebook Login pra conectar o perfil
 * Meta DESTA operação. O operador (membro) ou um admin pode conectar.
 * Guarda a operação em cookie (usada no callback) e deriva o redirect do domínio.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationId = url.searchParams.get("operationId");
  if (!operationId) return NextResponse.json({ ok: false, error: "Use ?operationId=..." }, { status: 400 });
  if (!process.env.META_APP_ID) return NextResponse.json({ ok: false, error: "META_APP_ID não configurado" }, { status: 500 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });

  // admin conecta qualquer operação; operador só as dele
  const op = await prisma.operation.findFirst({
    where:
      user.role === "admin"
        ? { id: operationId }
        : { id: operationId, memberships: { some: { userId: user.id } } },
    select: { id: true },
  });
  if (!op) return NextResponse.json({ ok: false, error: "sem acesso a essa operação" }, { status: 403 });

  const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
  const res = NextResponse.redirect(metaAuthorizeUrl(redirectUri, operationId));
  res.cookies.set("cr_meta_op", operationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 900,
    path: "/",
  });
  return res;
}
