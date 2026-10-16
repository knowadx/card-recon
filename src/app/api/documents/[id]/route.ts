import { prisma } from "@/lib/db";
import { AccessError, assertTransaction, guarded, requireUser } from "@/lib/access";
import { R2_PREFIX, StorageUnavailable, presignDownload } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/[id] — abre o anexo: confere que a transação é do grupo do usuário e
 * redireciona para uma URL do R2 válida por 5 minutos. Anexos antigos (gravados no disco do
 * servidor, que a Vercel apaga) respondem 410: o arquivo não foi preservado.
 */
export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new AccessError(404, "documento não encontrado");
  await assertTransaction(user, doc.transactionId);

  if (!doc.path.startsWith(R2_PREFIX)) {
    return Response.json({ error: "arquivo antigo: ficou no disco do servidor e não foi preservado; anexe de novo" }, { status: 410 });
  }
  try {
    const url = await presignDownload(doc.path.slice(R2_PREFIX.length), doc.filename);
    return Response.redirect(url, 302);
  } catch (e) {
    if (e instanceof StorageUnavailable) return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }
});
