import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";
import { btgConcluirConsentimento } from "@/lib/btg";
import { escapeHtml } from "@/lib/html";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html", "Set-Cookie": "cr_btg=; Max-Age=0; Path=/" },
    status,
  });

/** GET /api/btg/callback?code=&state= — troca o code pelo token e grava a conexão BTG da empresa. */
export const GET = guarded(async (request: NextRequest) => {
  await requireSuperadmin(); // o navegador que abriu o /api/btg/auth é o do administrador geral
  const p = request.nextUrl.searchParams;
  const error = p.get("error_description") || p.get("error");
  if (error) return html(`<h2>Autorização negada</h2><p>${escapeHtml(error)}</p>`, 400);
  const code = p.get("code");
  if (!code) return html("<h2>Código ausente</h2><p>O BTG não devolveu o code. Conecte de novo.</p>", 400);
  const state = p.get("state");
  const esperado = request.cookies.get("cr_btg")?.value ?? null;
  if (!esperado || !state || state !== esperado) {
    return html("<h2>Conexão não reconhecida</h2><p>Esta autorização não foi iniciada aqui ou expirou. Conecte de novo pelo app.</p>", 400);
  }
  const empresa = await prisma.company.findUnique({ where: { id: esperado.split(":")[0] }, select: { id: true, name: true, cnpj: true } });
  if (!empresa) return html("<h2>Empresa não encontrada</h2>", 404);
  try {
    const redirectUri = process.env.BTG_REDIRECT_URI || `${request.nextUrl.origin}/api/btg/callback`;
    await btgConcluirConsentimento(empresa, code, redirectUri);
    return html(`<h2 style="color:#00b9a5">✓ BTG conectado (${escapeHtml(empresa.name)})!</h2><p>Pode fechar esta janela e sincronizar a conta na aba Accounts.</p><script>setTimeout(function(){window.close()},2500)</script>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar o BTG</h2><pre style="white-space:pre-wrap">${escapeHtml((e as Error).message)}</pre>`, 500);
  }
});
