import { prisma } from "@/lib/db";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const convertToUsd = searchParams.get("usd") === "true";

  const whereAccount = companyId ? { account: { companyId } } : {};

  const yearStart = new Date(`${year}-01-01`);
  const yearEnd = new Date(`${year}-12-31T23:59:59.999Z`);

  const [splits, transactions, rateMap] = await Promise.all([
    prisma.transactionSplit.findMany({
      where: {
        transaction: { ...whereAccount, ignored: false },
        OR: [
          { accountingDate: { gte: yearStart, lte: yearEnd } },
          { accountingDate: null, transaction: { date: { gte: yearStart, lte: yearEnd } } },
        ],
      },
      include: {
        managerialCategory: true,
        accountingCategory: true,
        transaction: { select: { date: true, currency: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        ...whereAccount,
        ignored: false,
        date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
      },
      include: { account: { include: { company: true } } },
    }),
    convertToUsd ? loadRateMap() : Promise.resolve({} as Record<string, number>),
  ]);

  const managerialByMonth: Record<string, Record<string, number>> = {};
  const accountingByMonth: Record<string, Record<string, number>> = {};

  for (const split of splits) {
    const effectiveDate = split.accountingDate ?? split.transaction.date;
    const month = effectiveDate.toISOString().slice(0, 7);
    const currency = split.transaction.currency;

    const amount = convertToUsd
      ? toUsd(split.amount, currency, month, rateMap)
      : split.amount;

    if (split.managerialCategory) {
      if (!managerialByMonth[month]) managerialByMonth[month] = {};
      const key = split.managerialCategory.name;
      managerialByMonth[month][key] = (managerialByMonth[month][key] || 0) + amount;
    }

    if (split.accountingCategory) {
      if (!accountingByMonth[month]) accountingByMonth[month] = {};
      const key = split.accountingCategory.name;
      accountingByMonth[month][key] = (accountingByMonth[month][key] || 0) + amount;
    }
  }

  const byAccount: Record<string, { name: string; currency: string; company: string; inflow: number; outflow: number }> = {};
  for (const tx of transactions) {
    const key = tx.accountId;
    const month = tx.date.toISOString().slice(0, 7);
    const amount = convertToUsd
      ? toUsd(tx.amount, tx.currency, month, rateMap)
      : tx.amount;

    if (!byAccount[key]) {
      byAccount[key] = {
        name: tx.account.name,
        currency: convertToUsd ? "USD" : tx.currency,
        company: tx.account.company.name,
        inflow: 0,
        outflow: 0,
      };
    }
    if (amount >= 0) byAccount[key].inflow += amount;
    else byAccount[key].outflow += Math.abs(amount);
  }

  return Response.json({ managerialByMonth, accountingByMonth, byAccount, year, convertedToUsd: convertToUsd });
}
