import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeMetaCode, fetchMetaUser } from "@/lib/meta";
import { getCurrentUser, findMemberOperation } from "@/lib/auth";
import { escapeHtml } from "@/lib/html";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html", "Set-Cookie": "cr_meta_op=; Max-Age=0; Path=/" },
    status,
  });

/** GET /api/meta/callback?code=&state=<operationId> — troca o code por token long-lived e grava a credencial Meta da operação. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  // anti-CSRF: o state que volta da Meta tem que ser IDÊNTICO ao cookie gravado pelo /api/meta/auth
  // (operação + código aleatório). Sem cookie ou diferente = o pedido não começou neste navegador.
  const state = url.searchParams.get("state");
  const expected = request.cookies.get("cr_meta_op")?.value ?? null;

  if (error) return html(`<h2>Autorização negada</h2><p>${escapeHtml(error)}</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2>", 400);
  if (!expected || !state || state !== expected) {
    return html("<h2>Conexão não reconhecida</h2><p>Esta autorização não foi iniciada aqui ou expirou. Conecte de novo pelo app.</p>", 400);
  }
  const operationId = expected.split(":")[0];

  // revalida acesso (o callback é público no middleware, mas o cookie de sessão chega aqui)
  const user = await getCurrentUser();
  if (!user) return html("<h2>Sessão expirada</h2><p>Entre de novo e reconecte.</p>", 401);
  const op = await findMemberOperation(user, operationId);
  if (!op) return html("<h2>Sem acesso a essa operação</h2>", 403);

  try {
    const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
    const token = await exchangeMetaCode(code, redirectUri);
    const profile = await fetchMetaUser(token); // nome do perfil Facebook que conectou
    const secrets = JSON.stringify({ metaUserId: profile?.id ?? null, metaUserName: profile?.name ?? null });
    // upsert pela operação (1 credencial Meta por operação)
    const existing = await prisma.credential.findFirst({ where: { issuer: "meta", operationId: op.id } });
    if (existing) {
      await prisma.credential.update({ where: { id: existing.id }, data: { token, company: op.name, isActive: true, secrets } });
    } else {
      await prisma.credential.create({ data: { issuer: "meta", company: op.name, operationId: op.id, token, secrets } });
    }
    const who = profile?.name ? ` como <strong>${escapeHtml(profile.name)}</strong>` : "";
    return html(`<h2 style="color:#00b9a5">✓ Meta conectado (${escapeHtml(op.name)})${who}!</h2><p>Pode fechar esta janela e voltar ao Fechamento Meta — a tela atualiza sozinha.</p><script>setTimeout(function(){window.close()},2000)</script>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar Meta</h2><pre style="white-space:pre-wrap">${escapeHtml((e as Error).message)}</pre>`, 500);
  }
}
