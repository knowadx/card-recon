import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const splits = await prisma.transactionSplit.findMany({
    where: { transactionId: id },
    include: { managerialCategory: true, accountingCategory: true },
  });
  return Response.json(splits);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const splits: Array<{ amount: number; note?: string; accountingDate?: string; managerialCategoryId?: string; accountingCategoryId?: string }> =
    body.splits;

  await prisma.transactionSplit.deleteMany({ where: { transactionId: id } });

  const created = await prisma.transactionSplit.createMany({
    data: splits.map((s) => ({
      transactionId: id,
      amount: s.amount,
      note: s.note || null,
      accountingDate: s.accountingDate ? new Date(s.accountingDate) : null,
      managerialCategoryId: s.managerialCategoryId || null,
      accountingCategoryId: s.accountingCategoryId || null,
    })),
  });

  return Response.json({ count: created.count });
}
