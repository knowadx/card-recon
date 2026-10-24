import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";
import { btgAuthorizeUrl, btgConfig, cnpjValido } from "@/lib/btg";

export const dynamic = "force-dynamic";

/**
 * GET /api/btg/auth?companyId=... — abre o login do BTG pra autorizar a leitura da conta PJ DESTA
 * empresa (o login escolhe o CNPJ). Configurar integração = só o administrador geral.
 * state = empresa + código aleatório; o callback exige que volte idêntico ao cookie (anti-CSRF).
 */
export const GET = guarded(async (request: Request) => {
  await requireSuperadmin();
  if (!btgConfig()) return NextResponse.json({ ok: false, error: "BTG não configurado no servidor (BTG_CLIENT_ID / BTG_CLIENT_SECRET)" }, { status: 503 });
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const empresa = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, cnpj: true } }) : null;
  if (!empresa) return NextResponse.json({ ok: false, error: "empresa não encontrada" }, { status: 404 });
  if (!cnpjValido(empresa.cnpj)) {
    return NextResponse.json({ ok: false, error: empresa.cnpj ? `o CNPJ de "${empresa.name}" (${empresa.cnpj}) é inválido — corrija no cadastro da empresa` : `cadastre o CNPJ de "${empresa.name}" antes de conectar o BTG` }, { status: 400 });
  }

  const redirectUri = process.env.BTG_REDIRECT_URI || `${url.origin}/api/btg/callback`;
  const state = `${empresa.id}:${randomBytes(16).toString("hex")}`;
  const res = NextResponse.redirect(btgAuthorizeUrl(redirectUri, state));
  res.cookies.set("cr_btg", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 900, path: "/" });
  return res;
});
