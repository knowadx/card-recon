import { prisma } from "@/lib/db";
import { assertTransaction, guarded, requireUser } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertTransaction(user, id);
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      account: { omit: { apiToken: true }, include: { company: true } }, // nunca devolve o token do banco
      splits: { include: { managerialCategory: true, accountingCategory: true, operation: { select: { id: true, name: true } } } },
      accountingSplits: { include: { accountingCategory: true } },
      documents: { select: { id: true, filename: true, mimetype: true, size: true, uploadedAt: true } },
    },
  });
  if (!tx) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(tx);
});
