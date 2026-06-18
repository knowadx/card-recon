"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type Tx = {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  cardLast4: string | null;
  cardLabel?: string | null;
  account: string | null;
  company: string | null;
  operation?: string | null;
  validatedBy?: string | null;
};
type WL = { id: string; last4: string; label: string | null; company: string | null };
type Combo = {
  last4: string | null;
  brand: string | null;
  account: string | null;
  accountId: string | null;
  bm: string | null;
  bmId: string | null;
  operation: string | null;
  currency: string | null;
  spent: number | null;
  source: string;
};
type Data = {
  counts: { leak: number; review: number; ok: number };
  leak: Tx[];
  review: Tx[];
  okSample?: Tx[];
  combos?: Combo[];
  metaAccounts: number;
  whitelist: WL[];
};

const PAGE_SIZE = 25;

function money(n: number, c: string) {
  return `${c} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChecagemPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // filtros compartilhados
  const [fOp, setFOp] = useState("");
  const [fCard, setFCard] = useState("");
  const [fAcct, setFAcct] = useState("");

  async function load() {
    setData(await fetch("/api/checagem").then((r) => r.json()));
  }
  useEffect(() => {
    load();
  }, []);

  async function run(path: string, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(path, { method: "POST" });
      const j = await r.json();
      setMsg(j.ok === false ? `❌ ${j.error}` : `✅ ${label}: ${JSON.stringify(j.check ?? j.summary ?? j)}`);
      await load();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function whitelistCard(last4: string) {
    await fetch("/api/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last4 }),
    });
    await run("/api/check", "Re-checagem");
  }
  async function removeWl(id: string) {
    await fetch(`/api/whitelist?id=${id}`, { method: "DELETE" });
    await run("/api/check", "Re-checagem");
  }

  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  const card = fCard.trim().toLowerCase();
  const acct = fAcct.trim().toLowerCase();

  // lista de operações p/ o dropdown (das transações + combos presentes)
  const operations = useMemo(() => {
    const set = new Set<string>();
    for (const t of data?.leak ?? []) if (t.operation) set.add(t.operation);
    for (const t of data?.review ?? []) if (t.operation) set.add(t.operation);
    for (const c of data?.combos ?? []) if (c.operation) set.add(c.operation);
    return Array.from(set).sort();
  }, [data]);

  // filtra transações por Operação + Cartão (conta de anúncio não se aplica a cobrança do extrato)
  const txMatch = (t: Tx) =>
    (!fOp || t.operation === fOp) && (!card || (t.cardLast4 ?? "").toLowerCase().includes(card));
  // filtra combos por Operação + Cartão + Conta de anúncio (ID/Nome)
  const comboMatch = (c: Combo) =>
    (!fOp || c.operation === fOp) &&
    (!card || (c.last4 ?? "").toLowerCase().includes(card)) &&
    (!acct || [c.account, c.accountId].some((v) => v?.toLowerCase().includes(acct)));

  const leakF = (data?.leak ?? []).filter(txMatch);
  const reviewF = (data?.review ?? []).filter(txMatch);
  const combosF = (data?.combos ?? []).filter(comboMatch);

  // Somatória do valor suspeito (🔴) sob o filtro atual, por moeda (somar moedas diferentes daria errado)
  const leakTotals = leakF.reduce<Record<string, number>>((acc, t) => {
    acc[t.currency] = (acc[t.currency] ?? 0) + t.amount;
    return acc;
  }, {});
  const leakTotalStr = Object.entries(leakTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => money(v, cur))
    .join("  ·  ") || "—";

  const filtering = !!(fOp || card || acct);
  const clearFilters = () => { setFOp(""); setFCard(""); setFAcct(""); };

  return (
    <div className="flex flex-col gap-5 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Checagem de cobranças Meta</h1>
          <p className="text-sm text-slate-500">
            Cobranças de Meta no extrato que NÃO batem com contas de anúncio que você controla → possível vazamento.
          </p>
        </div>
        <div className="flex gap-2">
          <button className={btn} disabled={busy !== null} onClick={() => run("/api/meta/sync", "Sync Meta")}>
            {busy === "Sync Meta" ? "Sincronizando…" : "Sync contas Meta"}
          </button>
          <button className={btn} disabled={busy !== null} onClick={() => run("/api/check", "Checagem")}>
            {busy === "Checagem" ? "Checando…" : "Rodar checagem"}
          </button>
        </div>
      </div>

      {msg && <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100">{msg}</pre>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="🔴 Vazamentos" value={data.counts.leak} warn={data.counts.leak > 0} />
            <Kpi label="⚪ A revisar" value={data.counts.review} />
            <Kpi label="🟢 OK" value={data.counts.ok} />
            <Kpi label="Contas Meta" value={data.metaAccounts} />
          </div>

          {/* Barra de filtros */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Operação
              <select className={input} value={fOp} onChange={(e) => setFOp(e.target.value)}>
                <option value="">Todas</option>
                {operations.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cartão (4 dígitos)
              <input className={input} placeholder="ex.: 6830" value={fCard} onChange={(e) => setFCard(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Conta de anúncio (ID ou nome)
              <input className={input + " min-w-[200px]"} placeholder="ex.: 1234567890 ou Conta X" value={fAcct} onChange={(e) => setFAcct(e.target.value)} />
            </label>
            {filtering && (
              <button className="text-xs text-indigo-600 hover:underline pb-1.5" onClick={clearFilters}>limpar filtros</button>
            )}
            <span className="ml-auto text-xs text-slate-400 pb-1.5">
              {acct ? "filtro de conta de anúncio só afeta o Mapa de cartões" : ""}
            </span>
          </div>

          {/* Somatória do valor suspeito sob o filtro atual */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="text-sm font-medium text-red-700">
              🔴 Valor suspeito{filtering ? " (filtro atual)" : ""} — {leakF.length} cobrança(s)
            </span>
            <span className="text-lg font-semibold tabular-nums text-red-700">{leakTotalStr}</span>
          </div>

          {/* Vazamentos */}
          <PagedSection
            title={`🔴 Cobranças suspeitas (${leakF.length}${filtering ? ` de ${data.leak.length}` : ""})`}
            empty={data.leak.length === 0 ? "Nenhuma cobrança Meta fora das suas contas. 👍" : "Nenhum resultado para o filtro."}
            rows={leakF}
            border="border-red-200"
            head={
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Operação</th>
                <th className="px-3 py-2">Empresa / Conta</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Cartão</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
            headClass="bg-red-50 text-red-700"
            row={(t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 tabular-nums">{t.date}</td>
                <td className="px-3 py-2 text-xs">{t.operation ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{t.company ?? "—"}<div className="text-slate-400">{t.account}</div></td>
                <td className="px-3 py-2">{t.description}</td>
                <td className="px-3 py-2 text-xs">
                  {t.cardLast4 ? `•••• ${t.cardLast4}` : "—"}
                  {t.cardLabel && <div className="text-[11px] text-slate-400">{t.cardLabel}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(t.amount, t.currency)}</td>
                <td className="px-3 py-2 text-right">
                  {t.cardLast4 && (
                    <button className="text-xs text-indigo-600 hover:underline" onClick={() => whitelistCard(t.cardLast4!)}>
                      marcar cartão como meu
                    </button>
                  )}
                </td>
              </tr>
            )}
          />

          {/* A revisar */}
          {data.review.length > 0 && (
            <PagedSection
              title={`⚪ A revisar — cobrança Meta sem cartão identificado (${reviewF.length}${filtering ? ` de ${data.review.length}` : ""})`}
              empty="Nenhum resultado para o filtro."
              rows={reviewF}
              border="border-slate-200"
              head={
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Operação</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              }
              headClass="bg-slate-50 text-slate-500"
              row={(t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 tabular-nums">{t.date}</td>
                  <td className="px-3 py-2 text-xs">{t.operation ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{t.company ?? "—"}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.amount, t.currency)}</td>
                </tr>
              )}
            />
          )}

          {/* Mapa cartão → onde gasta */}
          <PagedSection
            title={`Mapa de cartões — onde cada cartão gasta (${combosF.length}${filtering ? ` de ${data.combos?.length ?? 0}` : ""})`}
            note="Cada cartão de funding e as Contas de Anúncio / BMs (com IDs) que ele financia. Atualiza a cada Sync contas Meta. Cobrança nesses cartões entra como segura automaticamente."
            empty={(data.combos?.length ?? 0) === 0 ? "Nenhuma combinação ainda. Rode Sync contas Meta." : "Nenhum resultado para o filtro."}
            rows={combosF}
            border="border-slate-200"
            head={
              <tr>
                <th className="px-3 py-2">Cartão</th>
                <th className="px-3 py-2">Conta de anúncio</th>
                <th className="px-3 py-2">Account ID</th>
                <th className="px-3 py-2">BM</th>
                <th className="px-3 py-2">BM ID</th>
                <th className="px-3 py-2">Operação</th>
                <th className="px-3 py-2 text-right">Gasto (Meta)</th>
                <th className="px-3 py-2">Origem</th>
              </tr>
            }
            headClass="bg-slate-50 text-slate-500"
            row={(c, i) => (
              <tr key={i}>
                <td className="px-3 py-2 whitespace-nowrap">{c.brand ? `${c.brand} ` : ""}•••• {c.last4}</td>
                <td className="px-3 py-2 text-xs">{c.account ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{c.accountId ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{c.bm ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{c.bmId ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{c.operation ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.spent != null && c.currency ? money(c.spent, c.currency) : "—"}</td>
                <td className="px-3 py-2 text-xs">{c.source === "meta" ? "Meta" : "manual"}</td>
              </tr>
            )}
          />

          {/* Whitelist */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Cartões na whitelist ({data.whitelist.length})</h2>
            <p className="text-xs text-slate-500">Cartões marcados como legítimos (double-check do que a API do Meta não expõe).</p>
            {data.whitelist.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.whitelist.map((w) => (
                  <span key={w.id} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs">
                    •••• {w.last4} {w.label ? `(${w.label})` : ""}
                    <button className="text-red-600 hover:underline" onClick={() => removeWl(w.id)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Seção com tabela paginada (PAGE_SIZE por página). Reseta p/ página 1 quando os dados/filtros mudam. */
function PagedSection<T>({
  title, note, empty, rows, head, headClass, row, border,
}: {
  title: string;
  note?: string;
  empty: string;
  rows: T[];
  head: ReactNode;
  headClass: string;
  row: (item: T, index: number) => ReactNode;
  border: string;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { if (page > pages) setPage(1); }, [pages, page]);
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <>
          <div className={`overflow-x-auto rounded-lg border ${border} bg-white`}>
            <table className="w-full text-sm">
              <thead className={`text-left text-xs uppercase ${headClass}`}>{head}</thead>
              <tbody className="divide-y divide-slate-100">{slice.map((item, i) => row(item, start + i))}</tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3 text-xs text-slate-500">
              <span>{start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} de {rows.length}</span>
              <button className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ anterior</button>
              <span>{page}/{pages}</span>
              <button className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>próxima ›</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
