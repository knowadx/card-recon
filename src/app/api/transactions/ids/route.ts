import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const showIgnored = searchParams.get("showIgnored") === "true";
  const onlyIgnored = searchParams.get("onlyIgnored") === "true";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    ...(onlyIgnored ? { ignored: true } : showIgnored ? {} : { ignored: false }),
    ...(accountId ? { accountId } : {}),
    ...(companyId ? { account: { companyId } } : {}),
    ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
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
    ...(colAmountMin || colAmountMax ? {
      OR: [
        { amount: { ...(colAmountMin ? { gte: parseFloat(colAmountMin) } : {}), ...(colAmountMax ? { lte: parseFloat(colAmountMax) } : {}) } },
        { amount: { ...(colAmountMin ? { lte: -parseFloat(colAmountMin) } : {}), ...(colAmountMax ? { gte: -parseFloat(colAmountMax) } : {}) } },
      ],
    } : {}),
  };

  const rows = await prisma.transaction.findMany({ where, select: { id: true } });
  return Response.json({ ids: rows.map((r) => r.id) });
}
