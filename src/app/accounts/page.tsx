import { prisma } from "@/lib/db";
import { money } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<number, string> = {
  1: "ativa",
  2: "desativada",
  3: "irregular",
  7: "pending review",
  101: "fechada",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period = resolvePeriod(periodParam);

  const [accounts, cards] = await Promise.all([
    prisma.adAccount.findMany({
      include: { bm: true, snapshots: { where: { periodStart: period.start, periodEnd: period.end } } },
      orderBy: { name: "asc" },
    }),
    prisma.card.findMany({ select: { last4: true } }),
  ]);
  const knownLast4 = new Set(cards.map((c) => c.last4));

  const withCard = accounts.filter((a) => a.fundingCardLast4).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Contas de Anúncio ({accounts.length})</h1>
      <p className="text-sm text-slate-500">
        {withCard} com cartão de funding visível · período {period.key}. Cartão de funding em vermelho = fora do seu registro de bancos.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Conta</th>
              <th className="px-3 py-2">BM</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Cartão funding</th>
              <th className="px-3 py-2 text-right">Spend ({period.key})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((a) => {
              const spend = a.snapshots[0]?.spend ?? 0;
              const known = a.fundingCardLast4 ? knownLast4.has(a.fundingCardLast4) : false;
              return (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-slate-400">{a.accountId} · {a.currency}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{a.bm?.name ?? <span className="text-slate-400">sem BM</span>}</td>
                  <td className="px-3 py-2 text-xs">{a.accountStatus ? STATUS_LABEL[a.accountStatus] ?? a.accountStatus : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.fundingCardLast4 ? (
                      <span className={known ? "" : "text-red-600 font-medium"}>
                        {a.fundingCardBrand ?? ""} •••• {a.fundingCardLast4}
                        {!known && " ⚠"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{spend > 0 ? money(spend, a.currency) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {accounts.length === 0 && <p className="text-slate-500">Nenhuma conta — rode o Sync Meta.</p>}
    </div>
  );
}
