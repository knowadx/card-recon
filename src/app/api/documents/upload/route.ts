import { guarded, requireUser } from "@/lib/access";
import { readBody, startUpload } from "@/lib/documents";

/** POST /api/documents/upload — passo 1: confere dono/tipo/tamanho e devolve a URL assinada do R2. */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  return Response.json(await startUpload(user, await readBody(request)));
});
