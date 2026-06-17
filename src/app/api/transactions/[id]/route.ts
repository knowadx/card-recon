import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      account: { include: { company: true } },
      splits: { include: { managerialCategory: true, accountingCategory: true, operation: { select: { id: true, name: true } } } },
      accountingSplits: { include: { accountingCategory: true } },
      documents: true,
    },
  });
  if (!tx) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(tx);
}
