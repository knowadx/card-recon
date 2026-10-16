import { prisma } from "@/lib/db";
import { RequestError, guarded, requireManager, requireUser } from "@/lib/access";
import { isDuplicate, readBody, typeName } from "@/lib/documents";

/** GET /api/document-types — lista (todos leem), com quantos documentos usam cada tipo. */
export const GET = guarded(async () => {
  await requireUser();
  const types = await prisma.documentType.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { documents: true } } } });
  return Response.json(types.map(({ _count, ...t }) => ({ ...t, documents: _count.documents })));
});

/** POST — novo tipo (só admins: é configuração). */
export const POST = guarded(async (request: Request) => {
  await requireManager();
  const name = typeName((await readBody(request)).name);
  try {
    return Response.json(await prisma.documentType.create({ data: { name } }), { status: 201 });
  } catch (e) {
    if (isDuplicate(e)) throw new RequestError(409, "já existe um tipo com esse nome");
    throw e;
  }
});
