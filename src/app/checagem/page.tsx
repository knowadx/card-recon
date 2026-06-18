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
type MetaCharge = {
  id: string;
  transactionId: string;
  date: string;
  amount: number;
  currency: string;
  account: string | null;
  accountId: string;
  bm: string | null;
  operation: string | null;
  fundingCard: string | null;
};
type Monthly = { month: string; total: number; ok: number; leak: number; review: number; pending: number };
type Data = {
  counts: { leak: number; review: number; ok: number };
  monthly?: Monthly[];
  leak: Tx[];
  review: Tx[];
  metaAccounts: number;
  metaChargeCount?: number;
  metaCharges?: MetaCharge[];
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
  const [fBank, setFBank] = useState(""); // Empresa/Conta bancária da cobrança
  const [fMeta, setFMeta] = useState(""); // busca na tabela de cobranças do Meta (conta/BM)

  // janela de datas do sync (vazio = últimos 30 dias)
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  async function load() {
    setData(await fetch("/api/checagem").then((r) => r.json()));
  }
  useEffect(() => {
    load();
  }, []);

  async function run(path: string, label: string, body?: Record<string, unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
      const text = await r.text();
      let j: Record<string, unknown> | null = null;
      try { j = JSON.parse(text); } catch { /* resposta não-JSON (timeout/erro de plataforma) */ }
      if (!j) {
        setMsg(`⏱️ ${label}: a função excedeu o tempo (janela grande). O progresso foi salvo — use uma janela de datas menor e rode de novo, depois clique "Rodar match".`);
      } else {
        setMsg(j.ok === false ? `❌ ${j.error}` : `✅ ${label}: ${JSON.stringify(j.check ?? j.summary ?? j)}`);
      }
      await load();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  const card = fCard.trim().toLowerCase();

  // lista de operações p/ o dropdown
  const operations = useMemo(() => {
    const set = new Set<string>();
    for (const t of data?.leak ?? []) if (t.operation) set.add(t.operation);
    for (const t of data?.review ?? []) if (t.operation) set.add(t.operation);
    return Array.from(set).sort();
  }, [data]);

  // lista de Empresa/Conta bancária presentes (label "Empresa · Conta", valor = conta)
  const banks = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of [...(data?.leak ?? []), ...(data?.review ?? [])]) {
      if (t.account) m.set(t.account, `${t.company ? t.company + " · " : ""}${t.account}`);
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  // filtra cobranças do extrato por Operação + Cartão + Empresa/Conta
  const txMatch = (t: Tx) =>
    (!fOp || t.operation === fOp) &&
    (!card || (t.cardLast4 ?? "").toLowerCase().includes(card)) &&
    (!fBank || t.account === fBank);

  const leakF = (data?.leak ?? []).filter(txMatch);
  const reviewF = (data?.review ?? []).filter(txMatch);

  // cobranças dentro do Meta: filtra por Operação (compartilhado) + busca conta/BM
  const metaQ = fMeta.trim().toLowerCase();
  const metaChargesF = (data?.metaCharges ?? []).filter(
    (m) =>
      (!fOp || m.operation === fOp) &&
      (!metaQ || [m.account, m.accountId, m.bm, m.transactionId].some((v) => v?.toLowerCase().includes(metaQ))),
  );

  // Somatória do valor suspeito (🔴) sob o filtro atual, por moeda
  const leakTotals = leakF.reduce<Record<string, number>>((acc, t) => {
    acc[t.currency] = (acc[t.currency] ?? 0) + t.amount;
    return acc;
  }, {});
  const leakTotalStr = Object.entries(leakTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => money(v, cur))
    .join("  ·  ") || "—";

  const filtering = !!(fOp || card || fBank || fMeta);
  const clearFilters = () => { setFOp(""); setFCard(""); setFBank(""); setFMeta(""); };

  return (
    <div className="flex flex-col gap-5 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Checagem de cobranças Meta</h1>
          <p className="text-sm text-slate-500">
            Cada cobrança Meta do extrato é casada com uma cobrança real de uma conta sua (por valor + data).
            Sem par em conta sua → possível vazamento.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            de
            <input type="date" className={input} value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            até
            <input type="date" className={input} value={syncTo} onChange={(e) => setSyncTo(e.target.value)} />
          </label>
          <button className={btn} disabled={busy !== null} onClick={() => run("/api/meta/sync", "Sincronizar Meta", { from: syncFrom || undefined, to: syncTo || undefined })}>
            {busy === "Sincronizar Meta" ? "Sincronizando…" : "Sincronizar Meta"}
          </button>
          <button className={btn} disabled={busy !== null} onClick={() => run("/api/check", "Rodar match")} title="Re-roda o match com os dados já no banco (instantâneo, não chama a API)">
            {busy === "Rodar match" ? "Rodando…" : "Rodar match"}
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

          {/* Controle mensal — cobranças por mês e quantas faltam identificar */}
          {(data.monthly?.length ?? 0) > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Controle mensal</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Mês</th>
                      <th className="px-3 py-2 text-right">Cobranças</th>
                      <th className="px-3 py-2 text-right">🟢 OK</th>
                      <th className="px-3 py-2 text-right">🔴 Vazam.</th>
                      <th className="px-3 py-2 text-right">⚪ Revisar</th>
                      <th className="px-3 py-2 text-right">Pendentes</th>
                      <th className="px-3 py-2 text-right">% identif.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.monthly!.map((m) => {
                      const pct = m.total ? Math.round((m.ok / m.total) * 100) : 0;
                      return (
                        <tr key={m.month}>
                          <td className="px-3 py-2 tabular-nums">{m.month}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.total}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{m.ok}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-600">{m.leak}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m.review}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{m.pending}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${pct >= 90 ? "text-emerald-700" : pct >= 50 ? "text-amber-600" : "text-red-600"}`}>{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
              Empresa / Conta
              <select className={input + " max-w-[220px]"} value={fBank} onChange={(e) => setFBank(e.target.value)}>
                <option value="">Todas</option>
                {banks.map(([acc, label]) => <option key={acc} value={acc}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cartão (4 dígitos)
              <input className={input} placeholder="ex.: 6830" value={fCard} onChange={(e) => setFCard(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Conta/BM (Meta)
              <input className={input + " min-w-[160px]"} placeholder="nome ou ID da conta/BM" value={fMeta} onChange={(e) => setFMeta(e.target.value)} />
            </label>
            {filtering && (
              <button className="text-xs text-indigo-600 hover:underline pb-1.5" onClick={clearFilters}>limpar filtros</button>
            )}
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
              </tr>
            )}
          />

          {/* A revisar */}
          {data.review.length > 0 && (
            <PagedSection
              title={`⚪ A revisar — cobrança Meta sem valor p/ casar (${reviewF.length}${filtering ? ` de ${data.review.length}` : ""})`}
              note="Cobrança Meta sem valor utilizável p/ o match (raro)."
              empty="Nenhum resultado para o filtro."
              rows={reviewF}
              border="border-slate-200"
              head={
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Operação</th>
                  <th className="px-3 py-2">Empresa / Conta</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Cartão</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              }
              headClass="bg-slate-50 text-slate-500"
              row={(t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 tabular-nums">{t.date}</td>
                  <td className="px-3 py-2 text-xs">{t.operation ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{t.company ?? "—"}<div className="text-slate-400">{t.account}</div></td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className="px-3 py-2 text-xs">{t.cardLast4 ? `•••• ${t.cardLast4}` : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(t.amount, t.currency)}</td>
                </tr>
              )}
            />
          )}

          {/* Cobranças reais DENTRO do Meta (act/activities) — o outro lado do cruzamento */}
          <PagedSection
            title={`🔵 Cobranças dentro do Meta (${metaChargesF.length}${filtering ? ` de ${data.metaChargeCount ?? data.metaCharges?.length ?? 0}` : ` — ${data.metaChargeCount ?? 0} no total`})`}
            note="As cobranças que o Meta reporta por conta/BM. É contra estas que o extrato é casado (mesma moeda + valor + data). A cobrança em si NÃO traz cartão (a Meta não expõe); o 'Cartão (funding)' é o cartão primário da conta — referência, pode diferir do realmente cobrado."
            empty={(data.metaCharges?.length ?? 0) === 0 ? "Nenhuma cobrança Meta ainda. Rode Sincronizar Meta." : "Nenhum resultado para o filtro."}
            rows={metaChargesF}
            border="border-sky-200"
            head={
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">ID da cobrança</th>
                <th className="px-3 py-2">Conta de anúncio</th>
                <th className="px-3 py-2">Account ID</th>
                <th className="px-3 py-2">BM</th>
                <th className="px-3 py-2">Operação</th>
                <th className="px-3 py-2">Cartão (funding)</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            }
            headClass="bg-sky-50 text-sky-700"
            row={(m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 tabular-nums">{m.date}</td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-slate-500" title={m.transactionId}>{m.transactionId}</td>
                <td className="px-3 py-2 text-xs">{m.account ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{m.accountId}</td>
                <td className="px-3 py-2 text-xs">{m.bm ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{m.operation ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{m.fundingCard ? `•••• ${m.fundingCard}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(m.amount, m.currency)}</td>
              </tr>
            )}
          />
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
