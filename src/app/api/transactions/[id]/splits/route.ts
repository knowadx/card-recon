import { prisma } from "@/lib/db";
import { assertOperation, assertTransaction, guarded, requireUser } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertTransaction(user, id);
  const splits = await prisma.transactionSplit.findMany({
    where: { transactionId: id },
    include: { managerialCategory: true, accountingCategory: true, operation: { select: { id: true, name: true } } },
  });
  return Response.json(splits);
});

export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertTransaction(user, id);
  const body = await request.json();
  const splits: Array<{ amount: number; note?: string; accountingDate?: string; managerialCategoryId?: string; accountingCategoryId?: string; operationId?: string }> =
    body.splits;

  // toda operação gravada precisa existir (lista global) — antes de apagar qualquer coisa. O split é o ÚNICO
  // lugar da operação: a transação "é da operação X" se algum split for X (sem cópia na transação).
  const operationIds = new Set(splits.map((s) => s.operationId).filter(Boolean).map(String));
  for (const operationId of operationIds) await assertOperation(user, operationId);

  await prisma.transactionSplit.deleteMany({ where: { transactionId: id } });

  const created = await prisma.transactionSplit.createMany({
    data: splits.map((s) => ({
      transactionId: id,
      amount: s.amount,
      note: s.note || null,
      accountingDate: s.accountingDate ? new Date(s.accountingDate) : null,
      managerialCategoryId: s.managerialCategoryId || null,
      accountingCategoryId: s.accountingCategoryId || null,
      operationId: s.operationId || null,
    })),
  });

  return Response.json({ count: created.count });
});
