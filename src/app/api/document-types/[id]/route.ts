import { prisma } from "@/lib/db";
import { AccessError, RequestError, guarded, requireManager } from "@/lib/access";
import { isDuplicate, readBody, typeName } from "@/lib/documents";

type Ctx = { params: Promise<{ id: string }> };

async function findType(id: string) {
  const t = await prisma.documentType.findUnique({ where: { id }, include: { _count: { select: { documents: true } } } });
  if (!t) throw new AccessError(404, "tipo não encontrado");
  return t;
}

/** PUT — renomeia (só admins). */
export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  await requireManager();
  const t = await findType((await params).id);
  const name = typeName((await readBody(request)).name);
  try {
    return Response.json(await prisma.documentType.update({ where: { id: t.id }, data: { name } }));
  } catch (e) {
    if (isDuplicate(e)) throw new RequestError(409, "já existe um tipo com esse nome");
    throw e;
  }
});

/** DELETE — só admins, e só tipo sem documento (senão 409: troque o tipo dos documentos antes). */
export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  await requireManager();
  const t = await findType((await params).id);
  if (t._count.documents > 0) throw new RequestError(409, `tipo em uso por ${t._count.documents} documento(s)`);
  await prisma.documentType.delete({ where: { id: t.id } });
  return new Response(null, { status: 204 });
});
