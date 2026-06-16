import { NextResponse } from "next/server";
import { authorizeUrl, registerCompany } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/revolut/auth?company=Pixelados&client_id=XXX
 * Deriva o redirect do DOMÍNIO real desta requisição (Vercel/local), registra a
 * empresa+client_id+redirect e redireciona pro consentimento. Sem localhost fixo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const company = url.searchParams.get("company");
  const clientId = url.searchParams.get("client_id");
  if (!company || !clientId) {
    return NextResponse.json(
      { ok: false, error: "Use ?company=NomeDaEmpresa&client_id=SEU_CLIENT_ID" },
      { status: 400 },
    );
  }
  // env override (caso queira forçar) senão o domínio atual
  const redirectUri = process.env.REVOLUT_REDIRECT_URI || `${url.origin}/api/revolut/callback`;
  await registerCompany(company, clientId, redirectUri);
  return NextResponse.redirect(authorizeUrl(clientId, company, redirectUri));
}
