import { NextResponse } from "next/server";
import { authorizeUrl, registerCompany } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/revolut/auth?company=Pixelads&client_id=XXX
 * Registra a empresa + client_id e redireciona pro consentimento OAuth do Revolut.
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
  await registerCompany(company, clientId);
  return NextResponse.redirect(authorizeUrl(clientId, company));
}
