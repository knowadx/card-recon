import { NextResponse } from "next/server";
import { metaAuthorizeUrl } from "@/lib/meta";

export const dynamic = "force-dynamic";

/**
 * GET /api/meta/auth?label=NomeDoPerfil — abre o Facebook Login pra esse perfil.
 * Guarda o label em cookie (pra usar no callback) e deriva o redirect do domínio.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const label = url.searchParams.get("label");
  if (!label) return NextResponse.json({ ok: false, error: "Use ?label=NomeDoPerfil" }, { status: 400 });
  if (!process.env.META_APP_ID) return NextResponse.json({ ok: false, error: "META_APP_ID não configurado" }, { status: 500 });

  const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
  const res = NextResponse.redirect(metaAuthorizeUrl(redirectUri, label));
  res.cookies.set("cr_meta_label", encodeURIComponent(label), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 900,
    path: "/",
  });
  return res;
}
