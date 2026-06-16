import { reconcile } from "@/lib/reconcile";
import { resolvePeriod } from "@/lib/period";
import { money, STATUS_META } from "@/lib/format";
import { SyncBar } from "@/components/SyncBar";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period = resolvePeriod(periodParam).key;
  const r = await reconcile(period);

  const hasData = r.cards.length > 0 || r.byBM.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Conciliação — {r.period}</h1>
          <span className="text-sm text-slate-500">tolerância {(r.tolerancePct * 100).toFixed(0)}%</span>
        </div>
        <SyncBar period={r.period} />
      </div>

      {!hasData && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nenhum dado ainda. Rode <strong>Sync Meta</strong> (e os bancos) acima.
          <br />
          Configure os tokens em <a className="underline" href="/settings">Config</a>.
        </div>
      )}

      {hasData && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Spend (Meta)" value={money(r.totals.expectedSpend)} />
          <Kpi label="Cobrado (cartões)" value={money(r.totals.actualCharged)} />
          <Kpi
            label="Diferença"
            value={money(r.totals.actualCharged - r.totals.expectedSpend)}
            warn={Math.abs(r.totals.actualCharged - r.totals.expectedSpend) > 1}
          />
        </div>
      )}

      {r.totals.mixedCurrency && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 border border-amber-200">
          ⚠️ Há moedas diferentes entre contas/cobranças — os totais não estão convertidos por câmbio.
          Olhe a conciliação por cartão (mesma moeda) para precisão.
        </p>
      )}

      {r.alerts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Alertas ({r.alerts.length})</h2>
          {r.alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-md border px-3 py-2 text-sm ${
                a.level === "red"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <span className="font-semibold">
                {a.level === "red" ? "🔴" : "🟠"} {a.title}
              </span>
              <div className="text-[13px] opacity-90">{a.detail}</div>
            </div>
          ))}
        </section>
      )}

      {r.cards.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Por cartão</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Cartão</th>
                  <th className="px-3 py-2">Contas / BM</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                  <th className="px-3 py-2 text-right">Cobrado</th>
                  <th className="px-3 py-2 text-right">Diff</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.cards.map((c) => {
                  const sm = STATUS_META[c.status];
                  return (
                    <tr key={c.last4} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">•••• {c.last4}</div>
                        <div className="text-xs text-slate-500">
                          {c.brands.join(", ") || "—"}
                          {c.issuers.length > 0 && ` · ${c.issuers.join("/")}`}
                          {!c.cardKnown && <span className="text-red-600"> · não registrado</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {c.accounts.length === 0 ? (
                          <span className="text-slate-400">nenhuma conta</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {c.accounts.map((a) => (
                              <li key={a.id} className="text-xs">
                                {a.name}
                                <span className="text-slate-400"> · {a.bmName ?? "sem BM"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.expectedSpend)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.actualCharged)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          Math.abs(c.diff) > 1 ? "font-semibold" : ""
                        }`}
                      >
                        {money(c.diff)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${sm.cls}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} /> {sm.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {r.metaChargesNoCard.count > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Cobranças Meta sem cartão (transferências/wires) — {r.metaChargesNoCard.count}, total {money(r.metaChargesNoCard.total)}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Banco / Empresa</th>
                  <th className="px-3 py-2">Merchant</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.metaChargesNoCard.items.map((c, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 tabular-nums">{c.date}</td>
                    <td className="px-3 py-2">
                      {c.issuer}
                      {c.company && c.company !== "default" && <span className="text-slate-400"> · {c.company}</span>}
                    </td>
                    <td className="px-3 py-2">{c.merchant ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.amount, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Pagamentos ao Meta sem cartão associado (ex.: transferência/wire). Entram no total cobrado, mas não na conciliação por cartão.
          </p>
        </section>
      )}

      {r.byBM.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Spend por BM</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {r.byBM.map((bm) => (
              <div key={bm.bmId ?? "none"} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{bm.bmName}</span>
                  <span className="tabular-nums text-sm">{money(bm.totalSpend)}</span>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {bm.accounts.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span>
                        {a.name}{" "}
                        {a.last4 ? (
                          <span className="text-slate-400">•••• {a.last4}</span>
                        ) : (
                          <span className="text-red-500">sem cartão</span>
                        )}
                      </span>
                      <span className="tabular-nums">{money(a.spend)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-amber-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
