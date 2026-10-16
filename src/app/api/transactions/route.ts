import { prisma } from "@/lib/db";
import { assertAccount, assertOperation, guarded, requireUser, transactionScope } from "@/lib/access";

const PAGE_SIZE = 100;

export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const showIgnored = searchParams.get("showIgnored") === "true";
  const onlyIgnored = searchParams.get("onlyIgnored") === "true";
  const skip = parseInt(searchParams.get("skip") ?? "0", 10);
  const take = parseInt(searchParams.get("take") ?? String(PAGE_SIZE), 10);

  // Column filters
  const search = searchParams.get("search") ?? "";
  const colCompany = searchParams.get("colCompany") ?? "";
  const colAccount = searchParams.get("colAccount") ?? "";
  const colStatus = searchParams.get("colStatus") ?? "";
  const colStatusAccounting = searchParams.get("colStatusAccounting") ?? "";
  const colDirection = searchParams.get("colDirection") ?? "";
  const colManagerial = searchParams.get("colManagerial") ?? "";
  const colAccounting = searchParams.get("colAccounting") ?? "";
  const colAmountMin = searchParams.get("colAmountMin") ?? "";
  const colAmountMax = searchParams.get("colAmountMax") ?? "";
  const colFatura = searchParams.get("colFatura") ?? ""; // "" | meta | com | sem (Possui Fatura)

  // SQLite/libSQL does not support mode:"insensitive" — use plain contains (already case-insensitive on ASCII in SQLite)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    ...(onlyIgnored ? { ignored: true } : showIgnored ? {} : { ignored: false }),
    // Global filters
    ...(accountId ? { accountId } : {}),
    ...(companyId ? { account: { companyId } } : {}),
    // from/to já chegam como ISO/UTC dos limites do dia no fuso local do cliente (ver transactions/page)
    ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    // Column filters
    ...(colAccount ? { accountId: colAccount } : {}),
    ...(colCompany ? { account: { companyId: colCompany } } : {}),
    ...(search ? { OR: [{ description: { contains: search } }, { reference: { contains: search } }] } : {}),
    ...(colStatus === "categorized" ? { splits: { some: { managerialCategoryId: { not: null } } } } : {}),
    ...(colStatus === "pending" ? { NOT: { splits: { some: { managerialCategoryId: { not: null } } } } } : {}),
    ...(colStatusAccounting === "categorized" ? { splits: { some: { accountingCategoryId: { not: null } } } } : {}),
    ...(colStatusAccounting === "pending" ? { NOT: { splits: { some: { accountingCategoryId: { not: null } } } } } : {}),
    ...(colDirection === "in" ? { amount: { gt: 0 } } : {}),
    ...(colDirection === "out" ? { amount: { lt: 0 } } : {}),
    // Possui Fatura (check de vazamento): meta=todas Meta, com=tem PDF, sem=Meta sem PDF (🔴)
    ...(colFatura === "meta" ? { isMetaCharge: true } : {}),
    ...(colFatura === "com" ? { isMetaCharge: true, hasReceipt: true } : {}),
    ...(colFatura === "sem" ? { isMetaCharge: true, hasReceipt: false } : {}),
    ...(colManagerial ? { splits: { some: { managerialCategoryId: colManagerial } } } : {}),
    ...(colAccounting ? { splits: { some: { accountingCategoryId: colAccounting } } } : {}),
    // Amount filter: user enters absolute value, transactions can be negative or positive
    ...(colAmountMin || colAmountMax ? {
      OR: [
        {
          amount: {
            ...(colAmountMin ? { gte: parseFloat(colAmountMin) } : {}),
            ...(colAmountMax ? { lte: parseFloat(colAmountMax) } : {}),
          },
        },
        {
          amount: {
            ...(colAmountMin ? { lte: -parseFloat(colAmountMin) } : {}),
            ...(colAmountMax ? { gte: -parseFloat(colAmountMax) } : {}),
          },
        },
      ],
    } : {}),
  };

  // Escopo do usuário (peça única em access.ts): holdings (empresa da conta) OU operações (da transação OU da conta).
  // Vai em AND — o where já usa OR (busca/valor) e não pode ser sobrescrito.
  where.AND = [...(where.AND ?? []), await transactionScope(user)];

  const findManyArgs = {
    where,
    include: {
      account: { omit: { apiToken: true }, include: { company: true } }, // nunca devolve o token do banco
      splits: { include: { managerialCategory: true, accountingCategory: true, operation: { select: { id: true, name: true } } } },
      accountingSplits: { include: { accountingCategory: true } },
      documents: true,
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
  if (body.operationId) await assertOperation(user, String(body.operationId));
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
      documents: true,
    },
  });
  return Response.json(transaction, { status: 201 });
});
