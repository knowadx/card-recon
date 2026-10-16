import { guarded, requireManager, requireUser } from "@/lib/access";
import { assertDocument, deleteDocument, publicDoc, readBody, updateCompanyDocument } from "@/lib/documents";
import { R2_PREFIX, StorageUnavailable, presignDownload } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/[id] — abre o arquivo: confere que o documento é do grupo do usuário e
 * redireciona para uma URL do R2 válida por 5 minutos. Anexos antigos (gravados no disco do
 * servidor, que a Vercel apaga) respondem 410: o arquivo não foi preservado.
 */
export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const doc = await assertDocument(user, (await params).id);

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

/** PATCH — corrige tipo, título e datas de um documento da empresa (quem é do grupo). */
export const PATCH = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const doc = await updateCompanyDocument(user, (await params).id, await readBody(request));
  return Response.json(publicDoc(doc));
});

/** DELETE — só admins apagam (decisão do dono em 2026-10-16). Apaga o arquivo e o registro. */
export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireManager();
  await deleteDocument(user, (await params).id);
  return new Response(null, { status: 204 });
});
