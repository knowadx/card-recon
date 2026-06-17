import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeMetaCode } from "@/lib/meta";
import { getCurrentUser, findAccessibleOperation } from "@/lib/auth";

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
  const operationId = url.searchParams.get("state") || request.cookies.get("cr_meta_op")?.value || null;

  if (error) return html(`<h2>Autorização negada</h2><p>${error}</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2>", 400);
  if (!operationId) return html("<h2>Operação não identificada</h2><p>Cookie expirou. Conecte de novo.</p>", 400);

  // revalida acesso (o callback é público no middleware, mas o cookie de sessão chega aqui)
  const user = await getCurrentUser();
  if (!user) return html("<h2>Sessão expirada</h2><p>Entre de novo e reconecte.</p>", 401);
  const op = await findAccessibleOperation(user, operationId);
  if (!op) return html("<h2>Sem acesso a essa operação</h2>", 403);

  try {
    const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/meta/callback`;
    const token = await exchangeMetaCode(code, redirectUri);
    // upsert pela operação (1 credencial Meta por operação)
    const existing = await prisma.credential.findFirst({ where: { issuer: "meta", operationId: op.id } });
    if (existing) {
      await prisma.credential.update({ where: { id: existing.id }, data: { token, company: op.name, isActive: true } });
    } else {
      await prisma.credential.create({ data: { issuer: "meta", company: op.name, operationId: op.id, token } });
    }
    return html(`<h2 style="color:#00b9a5">✓ Meta conectado (${op.name})!</h2><p>Pode fechar esta aba. Rode "Sync contas Meta" na Checagem.</p>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar Meta</h2><pre style="white-space:pre-wrap">${(e as Error).message}</pre>`, 500);
  }
}
