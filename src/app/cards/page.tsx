import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const [cards, accounts, metaCharges] = await Promise.all([
    prisma.card.findMany({ orderBy: [{ issuer: "asc" }, { last4: "asc" }] }),
    prisma.adAccount.findMany({ where: { NOT: { fundingCardLast4: null } }, select: { name: true, fundingCardLast4: true } }),
    prisma.bankCharge.groupBy({
      by: ["cardLast4"],
      where: { isMetaCharge: true, NOT: { cardLast4: null } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const acctByLast4 = new Map<string, string[]>();
  for (const a of accounts) {
    if (!a.fundingCardLast4) continue;
    const arr = acctByLast4.get(a.fundingCardLast4) ?? [];
    arr.push(a.name);
    acctByLast4.set(a.fundingCardLast4, arr);
  }
  const metaByLast4 = new Map(metaCharges.map((m) => [m.cardLast4!, { count: m._count._all, sum: m._sum.amount ?? 0 }]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Cartões registrados ({cards.length})</h1>
      <p className="text-sm text-slate-500">
        Cartões vindos das APIs dos bancos. São a “verdade” do que é seu — um cartão de funding do Meta fora desta lista vira alerta vermelho.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Cartão</th>
              <th className="px-3 py-2">Banco / Empresa</th>
              <th className="px-3 py-2">Apelido</th>
              <th className="px-3 py-2">Financia contas Meta</th>
              <th className="px-3 py-2 text-right">Cobr. Meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.map((c) => {
              const accts = acctByLast4.get(c.last4) ?? [];
              const meta = metaByLast4.get(c.last4);
              return (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">•••• {c.last4}</div>
                    <div className="text-xs text-slate-500">{c.brand ?? "—"} · {c.state ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    {c.issuer}
                    {c.company && c.company !== "default" && <span className="text-slate-400"> · {c.company}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.label ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {accts.length === 0 ? <span className="text-slate-400">nenhuma</span> : accts.join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {meta ? `${meta.count}× · ${meta.sum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cards.length === 0 && <p className="text-slate-500">Nenhum cartão ainda — rode os syncs dos bancos.</p>}
    </div>
  );
}
