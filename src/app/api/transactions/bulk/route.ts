import { prisma } from "@/lib/db";

const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// DELETE: remove transactions by ids
export async function DELETE(request: Request) {
  const { ids } = await request.json() as { ids: string[] };
  if (!ids?.length) return Response.json({ error: "ids required" }, { status: 400 });

  for (const batch of chunk(ids, CHUNK)) {
    await prisma.transactionSplit.deleteMany({ where: { transactionId: { in: batch } } });
    await prisma.document.deleteMany({ where: { transactionId: { in: batch } } });
    await prisma.transaction.deleteMany({ where: { id: { in: batch } } });
  }

  return Response.json({ deleted: ids.length });
}

// PATCH: set ignored flag
export async function PATCH(request: Request) {
  const { ids, ignored } = await request.json() as { ids: string[]; ignored: boolean };
  if (!ids?.length) return Response.json({ error: "ids required" }, { status: 400 });

  for (const batch of chunk(ids, CHUNK)) {
    await prisma.transaction.updateMany({ where: { id: { in: batch } }, data: { ignored } });
  }

  return Response.json({ updated: ids.length });
}

// PUT: apply a category to all selected transactions (creates/updates single split)
export async function PUT(request: Request) {
  const { ids, managerialCategoryId, accountingCategoryId } = await request.json() as {
    ids: string[];
    managerialCategoryId?: string;
    accountingCategoryId?: string;
  };
  if (!ids?.length) return Response.json({ error: "ids required" }, { status: 400 });

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: { splits: true },
  });

  await Promise.all(
    transactions.map(async (tx) => {
      if (tx.splits.length === 1) {
        // update existing single split
        await prisma.transactionSplit.update({
          where: { id: tx.splits[0].id },
          data: {
            ...(managerialCategoryId !== undefined && { managerialCategoryId: managerialCategoryId || null }),
            ...(accountingCategoryId !== undefined && { accountingCategoryId: accountingCategoryId || null }),
          },
        });
      } else if (tx.splits.length === 0) {
        // create a split
        await prisma.transactionSplit.create({
          data: {
            transactionId: tx.id,
            amount: tx.amount,
            managerialCategoryId: managerialCategoryId || null,
            accountingCategoryId: accountingCategoryId || null,
          },
        });
      } else {
        // multiple splits: apply to all
        await prisma.transactionSplit.updateMany({
          where: { transactionId: tx.id },
          data: {
            ...(managerialCategoryId !== undefined && { managerialCategoryId: managerialCategoryId || null }),
            ...(accountingCategoryId !== undefined && { accountingCategoryId: accountingCategoryId || null }),
          },
        });
      }
    })
  );

  return Response.json({ updated: ids.length });
}
