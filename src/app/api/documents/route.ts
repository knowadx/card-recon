import { guarded, requireUser } from "@/lib/access";
import { createDocument, listCompanyDocuments, publicDoc, readBody } from "@/lib/documents";

/** GET /api/documents — documentos da empresa visíveis (filtros: companyId, typeId, status, q, historico=1). */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  return Response.json(await listCompanyDocuments(user, new URL(request.url).searchParams));
});

/** POST /api/documents — passo 2 do upload: o arquivo chegou ao R2 → registra (empresa ou transação). */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const doc = await createDocument(user, await readBody(request));
  return Response.json(publicDoc(doc), { status: 201 });
});
