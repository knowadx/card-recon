import { prisma } from "@/lib/db";
import { RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import { inicioDoDia, registrarCobertura } from "@/lib/cobertura";
import { KINDS_DE_ARQUIVO } from "@/lib/importacaoArquivo";

/**
 * POST /api/coverage/periodo { accountId, importLogId, de, ate } — confirma o período que um arquivo SEM
 * período dentro (Husky, Dolafy, CSV genérico) cobre (src/lib/importacaoArquivo.ts). Grava a cobertura
 * "arquivo" de `de` até o fim de `ate` (dias inteiros). Só vale pro arquivo importado NESTA conta, e nunca
 * pra frente de hoje (dia que não aconteceu não foi importado).
 */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const accountId = String(body.accountId ?? "");
  await assertAccount(user, accountId);
  const { de, ate, importLogId } = body as { de?: string; ate?: string; importLogId?: string };
  if (!de || !ate || !DIA.test(de) || !DIA.test(ate) || de > ate) throw new RequestError(400, "período inválido: informe de e até (AAAA-MM-DD), com de ≤ até");
  if (ate > new Date().toISOString().slice(0, 10)) throw new RequestError(400, "o período não pode passar de hoje");

  const log = importLogId ? await prisma.importLog.findUnique({ where: { id: String(importLogId) } }) : null;
  let daConta = false;
  try { daConta = !!log && JSON.parse(log.summary).accountId === accountId; } catch { daConta = false; }
  if (!log || !(KINDS_DE_ARQUIVO as readonly string[]).includes(log.kind) || !daConta) {
    throw new RequestError(400, "esse arquivo não foi importado nesta conta");
  }

  await registrarCobertura({
    accountId, de: inicioDoDia(de), ate: new Date(inicioDoDia(ate).getTime() + 86_400_000), fonte: "arquivo", userId: user.id, importLogId: log.id,
  });
  return Response.json({ ok: true });
});
