import { prisma } from "@/lib/db";
import { AccessError, RequestError, guarded, requireUser } from "@/lib/access";
import { StorageUnavailable, presignDownload } from "@/lib/storage";
import { podeVerFatura } from "@/lib/faturasMeta";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/faturas-meta/:id/pdf — abre o PDF guardado da fatura (link de poucos minutos). */
export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const fatura = await prisma.metaReceipt.findUnique({ where: { id }, select: { referenceNumber: true, fileKey: true } });
  // sem acesso = 404 (não confirma que a fatura existe)
  if (!fatura || !(await podeVerFatura(user, fatura.referenceNumber))) throw new AccessError(404, "fatura não encontrada");
  if (!fatura.fileKey) throw new AccessError(404, "o PDF desta fatura não foi guardado (importe a pasta de novo)");
  try {
    return Response.redirect(await presignDownload(fatura.fileKey, `fatura-meta-${fatura.referenceNumber ?? id}.pdf`), 302);
  } catch (e) {
    if (e instanceof StorageUnavailable) throw new RequestError(503, "armazenamento de arquivos não configurado");
    throw e;
  }
});
