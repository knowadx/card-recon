import { NextResponse } from "next/server";
import { authorizeUrl, registerCompany } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/revolut/auth?company=Pixel Ads LLC&client_id=XXX
 * Deriva o redirect do domínio da requisição, registra a empresa+client_id+redirect,
 * guarda a empresa num cookie (o Revolut nem sempre devolve o `state`) e redireciona
 * pro consentimento.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const company = url.searchParams.get("company");
  const clientId = url.searchParams.get("client_id");
  if (!company || !clientId) {
    return NextResponse.json({ ok: false, error: "Use ?company=Nome&client_id=SEU_CLIENT_ID" }, { status: 400 });
  }
  const redirectUri = process.env.REVOLUT_REDIRECT_URI || `${url.origin}/api/revolut/callback`;
  await registerCompany(company, clientId, redirectUri);

  const res = NextResponse.redirect(authorizeUrl(clientId, company, redirectUri));
  res.cookies.set("cr_revolut_company", encodeURIComponent(company), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 900,
    path: "/",
  });
  return res;
}
