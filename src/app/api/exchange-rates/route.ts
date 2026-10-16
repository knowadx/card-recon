import { prisma } from "@/lib/db";
import { guarded, requireManager, requireUser, transactionScope } from "@/lib/access";

// Câmbio = configuração global: qualquer usuário logado lê; superadmin e admins alteram (member só lê).

// GET — list all exchange rates + currencies actually in use
export const GET = guarded(async () => {
  const user = await requireUser();
  const [rates, currencyGroups] = await Promise.all([
    prisma.exchangeRate.findMany({
      orderBy: [{ currency: "asc" }, { month: "desc" }],
    }),
    prisma.transaction.groupBy({
      by: ["currency"],
      where: { ignored: false, AND: [await transactionScope(user)] }, // moedas em uso: só as do grupo do usuário
      _count: true,
    }),
  ]);

  // All non-USD currencies found in transactions
  const usedCurrencies = currencyGroups
    .map(g => g.currency)
    .filter(c => c && c !== "USD")
    .sort();

  return Response.json({ rates, currencies: usedCurrencies });
});

// POST — upsert batch: [{ currency, month, rateToUsd }]
export const POST = guarded(async (request: Request) => {
  await requireManager();
  const { rates } = await request.json() as {
    rates: Array<{ currency: string; month: string; rateToUsd: number }>;
  };

  for (const r of rates) {
    if (!r.currency || !r.month || isNaN(r.rateToUsd)) continue;
    await prisma.exchangeRate.upsert({
      where: { currency_month: { currency: r.currency, month: r.month } },
      create: { id: `${r.currency}_${r.month}`, currency: r.currency, month: r.month, rateToUsd: r.rateToUsd },
      update: { rateToUsd: r.rateToUsd },
    });
  }

  return Response.json({ ok: true });
});
