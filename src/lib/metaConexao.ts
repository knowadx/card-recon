import { prisma } from "@/lib/db";
import { fetchMetaUser, inspecionarTokenMeta, META_PERMISSOES } from "@/lib/meta";

/**
 * Conexão Meta de uma OPERAÇÃO (1 credencial por operação) — mesma gravação para os dois jeitos de
 * conectar: o login do Facebook (/api/meta/callback) e o token colado (/api/meta/token).
 */
export async function salvarConexaoMeta(
  op: { id: string; name: string },
  token: string,
  extras: { tipo?: string | null; via: "login" | "token" },
): Promise<{ perfil: string | null }> {
  const profile = await fetchMetaUser(token); // nome do perfil (ou do usuário do sistema) dono do token
  const secrets = JSON.stringify({ metaUserId: profile?.id ?? null, metaUserName: profile?.name ?? null, tipo: extras.tipo ?? null, via: extras.via });
  const existing = await prisma.credential.findFirst({ where: { issuer: "meta", operationId: op.id } });
  if (existing) {
    await prisma.credential.update({ where: { id: existing.id }, data: { token, company: op.name, isActive: true, secrets } });
  } else {
    await prisma.credential.create({ data: { issuer: "meta", company: op.name, operationId: op.id, token, secrets } });
  }
  return { perfil: profile?.name ?? null };
}

export type ConferenciaToken =
  | { ok: true; tipo: string | null; expiraEm: string | null }
  | { ok: false; status: 400 | 422 | 503; erro: string };

/**
 * Token colado à mão (pensado pro "usuário do sistema" do Gerenciador de Negócios, que não passa pela
 * tela de login do Facebook e não vence). Só aceita o que a PRÓPRIA Meta confirma: válido, gerado para
 * o NOSSO app e com todas as META_PERMISSOES. O token nunca volta na resposta.
 */
export async function conferirTokenColado(token: string): Promise<ConferenciaToken> {
  if (!/^[A-Za-z0-9]{40,2000}$/.test(token)) return { ok: false, status: 400, erro: "isso não parece um token da Meta (só letras e números, sem espaços)" };
  const i = await inspecionarTokenMeta(token);
  if (!i.consultou) return { ok: false, status: 503, erro: i.erro };
  if (!i.valido) return { ok: false, status: 422, erro: `a Meta diz que o token não vale: ${i.erro}` };
  const nossoApp = process.env.META_APP_ID;
  if (i.appId !== nossoApp) return { ok: false, status: 422, erro: `token gerado para outro app (${i.appId ?? "?"}) — gere para o app ${nossoApp}` };
  const faltam = META_PERMISSOES.filter((p) => !i.permissoes.includes(p));
  if (faltam.length) return { ok: false, status: 422, erro: `faltam permissões no token: ${faltam.join(", ")}` };
  return { ok: true, tipo: i.tipo, expiraEm: i.expiraEm };
}
