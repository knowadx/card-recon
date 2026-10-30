import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { completeConsent } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";
import { escapeHtml } from "@/lib/html";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html", "Set-Cookie": "cr_revolut_company=; Max-Age=0; Path=/" },
    status,
  });

/**
 * GET /api/revolut/callback?code=... — empresa vem do cookie (Revolut nem sempre devolve state).
 * A rota é PÚBLICA no middleware (destino do OAuth) e o `state` é só o nome da empresa (forjável):
 * exige a sessão do administrador geral — o navegador que abriu o /api/revolut/auth é o dele.
 */
export const GET = guarded(async (request: NextRequest) => {
  await requireSuperadmin();
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  // A empresa vem SÓ do cookie gravado por /api/revolut/auth neste navegador (anti-CSRF). O Revolut
  // nem sempre devolve o state; quando devolve, tem que bater com o cookie.
  const cookieValue = request.cookies.get("cr_revolut_company")?.value;
  const company = cookieValue ? decodeURIComponent(cookieValue) : null; // ID da empresa
  const state = request.nextUrl.searchParams.get("state");

  if (error) return html(`<h2>Autorização negada</h2><p>${escapeHtml(error)}</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2><p>Revolut não retornou o code. Tente conectar de novo.</p>", 400);
  if (!company) return html("<h2>Empresa não identificada</h2><p>Cookie expirado. Clique em Conectar de novo (não demore a autorizar).</p>", 400);
  if (state && state !== company) return html("<h2>Conexão não reconhecida</h2><p>Esta autorização não foi iniciada aqui. Conecte de novo pelo app.</p>", 400);

  try {
    await completeConsent(company, code);
    const nome = (await prisma.company.findUnique({ where: { id: company }, select: { name: true } }))?.name ?? company;
    return html(`<h2 style="color:#00b9a5">✓ Revolut conectado (${escapeHtml(nome)})!</h2><p>Pode fechar esta aba.</p>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar</h2><pre style="white-space:pre-wrap">${escapeHtml((e as Error).message)}</pre>`, 500);
  }
});
