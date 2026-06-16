import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const splits = await prisma.accountingSplit.findMany({
    where: { transactionId: id },
    include: { accountingCategory: true },
  });
  return Response.json(splits);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
}
