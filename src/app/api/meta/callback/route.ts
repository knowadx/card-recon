import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeMetaCode } from "@/lib/meta";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html", "Set-Cookie": "cr_meta_label=; Max-Age=0; Path=/" },
    status,
  });

/** GET /api/meta/callback?code=&state=<label> — troca o code por token long-lived e grava a credencial Meta. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  const label =
    url.searchParams.get("state") ||
    (request.cookies.get("cr_meta_label")?.value ? decodeURIComponent(request.cookies.get("cr_meta_label")!.value) : null);

  if (error) return html(`<h2>Autorização negada</h2><p>${error}</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2>", 400);
  if (!label) return html("<h2>Perfil não identificado</h2><p>Cookie expirou. Conecte de novo.</p>", 400);

  try {
    const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
    const token = await exchangeMetaCode(code, redirectUri);
    await prisma.credential.upsert({
      where: { issuer_company: { issuer: "meta", company: label } },
      update: { token, isActive: true },
      create: { issuer: "meta", company: label, token },
    });
    return html(`<h2 style="color:#00b9a5">✓ Meta conectado (${label})!</h2><p>Pode fechar esta aba. Rode "Sync contas Meta" na Checagem.</p>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar Meta</h2><pre style="white-space:pre-wrap">${(e as Error).message}</pre>`, 500);
  }
}
