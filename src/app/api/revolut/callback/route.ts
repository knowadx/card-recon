import { NextRequest } from "next/server";
import { completeConsent } from "@/lib/revolut";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html", "Set-Cookie": "cr_revolut_company=; Max-Age=0; Path=/" },
    status,
  });

/** GET /api/revolut/callback?code=... — empresa vem do cookie (Revolut nem sempre devolve state). */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const company =
    request.nextUrl.searchParams.get("state") ||
    (request.cookies.get("cr_revolut_company")?.value
      ? decodeURIComponent(request.cookies.get("cr_revolut_company")!.value)
      : null);

  if (error) return html(`<h2>Autorização negada</h2><p>${error}</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2><p>Revolut não retornou o code. Tente conectar de novo.</p>", 400);
  if (!company) return html("<h2>Empresa não identificada</h2><p>Cookie expirado. Clique em Conectar de novo (não demore a autorizar).</p>", 400);

  try {
    await completeConsent(company, code);
    return html(`<h2 style="color:#00b9a5">✓ Revolut conectado (${company})!</h2><p>Pode fechar esta aba.</p>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar</h2><pre style="white-space:pre-wrap">${(e as Error).message}</pre>`, 500);
  }
}
