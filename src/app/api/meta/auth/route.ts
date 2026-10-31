import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { metaAuthorizeUrl } from "@/lib/meta";
import { getCurrentUser, findMemberOperation } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meta/auth?operationId=... — abre o Facebook Login pra conectar o perfil
 * Meta DESTA operação. Só quem opera (membro) ou o superadmin conecta.
 * Guarda a operação em cookie (usada no callback) e deriva o redirect do domínio.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationId = url.searchParams.get("operationId");
  if (!operationId) return NextResponse.json({ ok: false, error: "Use ?operationId=..." }, { status: 400 });
  if (!process.env.META_APP_ID) return NextResponse.json({ ok: false, error: "META_APP_ID não configurado" }, { status: 500 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });

  const op = await findMemberOperation(user, operationId);
  if (!op) return NextResponse.json({ ok: false, error: "sem acesso a essa operação" }, { status: 403 });

  const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
  // state = operação + código aleatório; o callback exige que volte idêntico ao cookie (anti-CSRF)
  const state = `${operationId}:${randomBytes(16).toString("hex")}`;
  const res = NextResponse.redirect(metaAuthorizeUrl(redirectUri, state));
  res.cookies.set("cr_meta_op", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 900,
    path: "/",
  });
  return res;
}
