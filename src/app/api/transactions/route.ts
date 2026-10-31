import { prisma } from "@/lib/db";
import { assertAccount, guarded, requireUser, transactionScope } from "@/lib/access";
import { transactionFilterWhere } from "@/lib/transactionFilters";

const PAGE_SIZE = 100;

export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const skip = parseInt(searchParams.get("skip") ?? "0", 10);
  const take = parseInt(searchParams.get("take") ?? String(PAGE_SIZE), 10);
  // Filtros da tela (fonte única, igual ao "selecionar todas") + escopo do usuário, em AND.
  const where = { AND: [transactionFilterWhere(searchParams), await transactionScope(user)] };

  const findManyArgs = {
    where,
    include: {
      account: { omit: { apiToken: true }, include: { company: true } }, // nunca devolve o token do banco
      splits: { include: { managerialCategory: true, accountingCategory: true, operation: { select: { id: true, name: true } } } },
      accountingSplits: { include: { accountingCategory: true } },
      documents: { select: { id: true, filename: true, mimetype: true, size: true, uploadedAt: true } },
    },
    orderBy: { date: "desc" as const },
    take: take + 1, // +1 sentinela p/ saber hasMore sem precisar do count
    skip,
  };

  // count (caro) só na 1ª página; nas demais o hasMore vem do +1 e o client mantém o total anterior
  let rows;
  let total: number | null = null;
  if (skip === 0) {
    const [r, t] = await Promise.all([prisma.transaction.findMany(findManyArgs), prisma.transaction.count({ where })]);
    rows = r; total = t;
  } else {
    rows = await prisma.transaction.findMany(findManyArgs);
  }
  const hasMore = rows.length > take;
  const data = hasMore ? rows.slice(0, take) : rows;

  return Response.json({ data, total, hasMore });
});

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json();
  await assertAccount(user, String(body.accountId ?? "")); // conta-alvo precisa ser minha
  const transaction = await prisma.transaction.create({
    data: {
      accountId: body.accountId,
      date: new Date(body.date),
      description: body.description,
      amount: body.amount,
      currency: body.currency,
      reference: body.reference || null,
    },
    include: {
      account: { omit: { apiToken: true }, include: { company: true } }, // nunca devolve o token do banco
      splits: true,
      documents: { select: { id: true, filename: true, mimetype: true, size: true, uploadedAt: true } },
    },
  });
  return Response.json(transaction, { status: 201 });
});
