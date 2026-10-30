import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeUrl, registerCompany } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/revolut/auth?companyId=…&client_id=XXX
 * Registra a empresa (pelo ID — o nome pode mudar) + client_id + redirect, guarda a empresa num cookie
 * (o Revolut nem sempre devolve o `state`) e redireciona pro consentimento.
 */
export const GET = guarded(async (request: Request) => {
  await requireSuperadmin(); // configurar integração = só o administrador geral
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const clientId = url.searchParams.get("client_id");
  if (!companyId || !clientId) {
    return NextResponse.json({ ok: false, error: "Use ?companyId=ID_DA_EMPRESA&client_id=SEU_CLIENT_ID" }, { status: 400 });
  }
  if (!(await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }))) {
    return NextResponse.json({ ok: false, error: "empresa não encontrada" }, { status: 404 });
  }
  const redirectUri = process.env.REVOLUT_REDIRECT_URI || `${url.origin}/api/revolut/callback`;
  await registerCompany(companyId, clientId, redirectUri);

  const res = NextResponse.redirect(authorizeUrl(clientId, companyId, redirectUri));
  res.cookies.set("cr_revolut_company", encodeURIComponent(companyId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 900,
    path: "/",
  });
  return res;
});
