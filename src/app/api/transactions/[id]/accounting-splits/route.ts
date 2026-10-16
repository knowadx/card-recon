import { prisma } from "@/lib/db";
import { assertTransaction, guarded, requireUser } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertTransaction(user, id);
  const splits = await prisma.accountingSplit.findMany({
    where: { transactionId: id },
    include: { accountingCategory: true },
  });
  return Response.json(splits);
});

export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertTransaction(user, id);
  const body = await request.json();
  const splits: Array<{
    amount: number;
    note?: string;
    accountingDate?: string;
    accountingCategoryId?: string;
  }> = body.splits;

  await prisma.accountingSplit.deleteMany({ where: { transactionId: id } });

  const created = await prisma.accountingSplit.createMany({
    data: splits.map(s => ({
      transactionId: id,
      amount: s.amount,
      note: s.note || null,
      accountingDate: s.accountingDate ? new Date(s.accountingDate) : null,
      accountingCategoryId: s.accountingCategoryId || null,
    })),
  });

  return Response.json({ count: created.count });
});
