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
  // fatura da Meta casada pelo código (mesma regra de src/lib/receipts.ts) — o PDF abre por /api/faturas-meta/:id/pdf
  const fatura = tx.isMetaCharge && tx.hasReceipt && tx.metaRef
    ? await prisma.metaReceipt.findFirst({
        where: { referenceNumber: { equals: tx.metaRef, mode: "insensitive" } },
        select: { id: true, fileKey: true, accountName: true },
      })
    : null;
  return Response.json({ ...tx, faturaMeta: fatura ? { id: fatura.id, pdf: !!fatura.fileKey, contaAnuncio: fatura.accountName } : null });
});
