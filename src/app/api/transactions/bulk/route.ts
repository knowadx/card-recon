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

// PUT: aplica/limpa uma categoria nas transações selecionadas.
// SUBSTITUI a classificação atual (não acumula): se já há split, atualiza; se há
// splits duplicados (não somam o valor da transação), colapsa em 1 (corrige valor
// dobrado); se não há split, cria. Splits legítimos (que somam o total) são preservados.
export async function PUT(request: Request) {
  const { ids, managerialCategoryId, accountingCategoryId } = await request.json() as {
    ids: string[];
    managerialCategoryId?: string;
    accountingCategoryId?: string;
  };
  if (!ids?.length) return Response.json({ error: "ids required" }, { status: 400 });

  // campos a setar (só os enviados; "" → null = limpar)
  const fields = {
    ...(managerialCategoryId !== undefined && { managerialCategoryId: managerialCategoryId || null }),
    ...(accountingCategoryId !== undefined && { accountingCategoryId: accountingCategoryId || null }),
  };

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: { splits: true },
  });

  await Promise.all(
    transactions.map(async (tx) => {
      if (tx.splits.length === 0) {
        // sem classificação → cria (comportamento atual)
        await prisma.transactionSplit.create({
          data: {
            transactionId: tx.id,
            amount: tx.amount,
            managerialCategoryId: managerialCategoryId || null,
            accountingCategoryId: accountingCategoryId || null,
          },
        });
        return;
      }

      const sum = tx.splits.reduce((s, x) => s + x.amount, 0);
      const duplicated = tx.splits.length > 1 && Math.abs(sum - tx.amount) > 0.01;

      if (duplicated) {
        // splits duplicados (valor dobrado) → mantém 1 com valor cheio, seta o campo, remove o resto
        const primary = tx.splits[0];
        await prisma.transactionSplit.update({ where: { id: primary.id }, data: { amount: tx.amount, ...fields } });
        await prisma.transactionSplit.deleteMany({ where: { transactionId: tx.id, id: { not: primary.id } } });
      } else {
        // 1 split, ou split legítimo (soma = total) → atualiza o campo nas linhas existentes (preserva a estrutura)
        await prisma.transactionSplit.updateMany({ where: { transactionId: tx.id }, data: fields });
      }
    })
  );

  return Response.json({ updated: ids.length });
}
