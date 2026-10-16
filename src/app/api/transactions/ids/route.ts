import { prisma } from "@/lib/db";
import { guarded, requireUser, transactionScope } from "@/lib/access";
import { transactionFilterWhere } from "@/lib/transactionFilters";

/** "Selecionar todas": exatamente as mesmas transações que a lista mostra (mesmos filtros + escopo). */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const where = { AND: [transactionFilterWhere(searchParams), await transactionScope(user)] };
  const rows = await prisma.transaction.findMany({ where, select: { id: true } });
  return Response.json({ ids: rows.map((r) => r.id) });
});
