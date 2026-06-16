import { prisma } from "@/lib/db";

const PAGE_SIZE = 100;

export async function GET(request: Request) {
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

  // SQLite/libSQL does not support mode:"insensitive" — use plain contains (already case-insensitive on ASCII in SQLite)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    ...(onlyIgnored ? { ignored: true } : showIgnored ? {} : { ignored: false }),
    // Global filters
    ...(accountId ? { accountId } : {}),
    ...(companyId ? { account: { companyId } } : {}),
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

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        account: { include: { company: true } },
        splits: { include: { managerialCategory: true, accountingCategory: true } },
        accountingSplits: { include: { accountingCategory: true } },
        documents: true,
      },
      orderBy: { date: "desc" },
      take,
      skip,
    }),
    prisma.transaction.count({ where }),
  ]);

  return Response.json({ data: transactions, total, hasMore: skip + take < total });
}

export async function POST(request: Request) {
  const body = await request.json();
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
      account: { include: { company: true } },
      splits: true,
      documents: true,
    },
  });
  return Response.json(transaction, { status: 201 });
}
