"use client";

import { useEffect, useState } from "react";

type Row = { data: string; transactionId: string; conta: string | null; accountId: string; bm: string | null; bmId: string | null; usd: number; moeda: string; hasPdf: boolean; facebk: string | null };
type Cell = { qtde: number; usd: number };
type Data = {
  mesesDisponiveis?: string[];
  contas?: { accountId: string; name: string }[];
  kpis?: { contas: number; cobrancas: number; totalUsd: number; comPdf: Cell; semPdf: Cell; pctComPdf: number };
  rows?: Row[];
};

const PAGE = 50;
const money = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CobrancasMetaPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [fMonth, setFMonth] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fPdf, setFPdf] = useState(""); // "" | com | sem

  const [syncFrom, setSyncFrom] = useState("");

  useEffect(() => {
    fetch("/api/settings/sync-period").then((r) => r.json()).then((p) => setSyncFrom(p.from ?? "")).catch(() => {});
  }, []);

  async function load() {
    const qs = new URLSearchParams();
    if (fMonth) qs.set("month", fMonth);
    if (fAccount) qs.set("account", fAccount);
    if (fPdf) qs.set("pdf", fPdf);
    const q = qs.toString();
    setData(await fetch(`/api/cobrancas-meta${q ? `?${q}` : ""}`).then((r) => r.json()));
    setPage(1);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fMonth, fAccount, fPdf]);

  async function savePeriod() {
    setBusy("Salvar período"); setMsg(null);
    try {
      const r = await fetch("/api/settings/sync-period", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: syncFrom }) });
      const j = await r.json();
      if (!r.ok) { setMsg(`❌ ${j.error}`); return; }
      setSyncFrom(j.from ?? "");
      setMsg(`✅ Piso salvo: a partir de ${j.from}. Syncs vão sempre até hoje.`);
      await load();
    } catch (e) { setMsg(`❌ ${(e as Error).message}`); } finally { setBusy(null); }
  }
  async function syncMeta() {
    setBusy("Sincronizar Meta"); setMsg(null);
    try {
      const r = await fetch("/api/meta/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: syncFrom || undefined }) });
      const text = await r.text(); let j: Record<string, unknown> | null = null;
      try { j = JSON.parse(text); } catch { /* não-JSON */ }
      setMsg(!j ? "⏱️ Sincronizar Meta excedeu o tempo. Progresso salvo — janela menor e rode de novo." : j.ok === false ? `❌ ${j.error}` : `✅ Meta: ${JSON.stringify(j)}`);
      await load();
    } catch (e) { setMsg(`❌ ${(e as Error).message}`); } finally { setBusy(null); }
  }

  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const k = data?.kpis;

  return (
    <div className="flex flex-col gap-5 p-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Cobranças Meta</h1>
          <p className="text-sm text-slate-500 max-w-xl">
            As cobranças que o <strong>Meta reporta</strong> das contas que você controla. Para cada uma, mostra se há <strong>PDF salvo</strong> (cruzando pelo ID da transação) e o <strong>código facebk</strong>. Dado bruto do Meta — <strong>não</strong> cruza com o banco (isso é a Checagem).
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">analisar a partir de<input type="date" className={input} value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} /></label>
            <button className={btn} disabled={busy !== null || !syncFrom} onClick={savePeriod}>{busy === "Salvar período" ? "Salvando…" : "Salvar piso"}</button>
            <button className={btn} disabled={busy !== null} onClick={syncMeta}>{busy === "Sincronizar Meta" ? "Sincronizando…" : "Sincronizar Meta"}</button>
          </div>
        </div>
      </div>

      {msg && <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100 whitespace-pre-wrap">{msg}</pre>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Contas controladas" value={String(k?.contas ?? 0)} />
            <Kpi label="Cobranças no período" value={String(k?.cobrancas ?? 0)} sub={money(k?.totalUsd ?? 0)} />
            <Kpi label="✅ Com PDF" value={`${k?.comPdf.qtde ?? 0} · ${k?.pctComPdf ?? 0}%`} sub={money(k?.comPdf.usd ?? 0)} />
            <Kpi label="🔴 Sem PDF" value={String(k?.semPdf.qtde ?? 0)} sub={money(k?.semPdf.usd ?? 0)} warn={(k?.semPdf.qtde ?? 0) > 0} />
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">Mês
              <select className={input} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                <option value="">Todos</option>
                {(data.mesesDisponiveis ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Conta de anúncio
              <select className={input + " max-w-[240px]"} value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
                <option value="">Todas</option>
                {(data.contas ?? []).map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">PDF
              <select className={input} value={fPdf} onChange={(e) => setFPdf(e.target.value)}>
                <option value="">Todos</option>
                <option value="com">✅ Com PDF</option>
                <option value="sem">🔴 Sem PDF</option>
              </select></label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Conta de anúncio</th>
                  <th className="px-3 py-2">BM</th>
                  <th className="px-3 py-2 text-center">PDF</th>
                  <th className="px-3 py-2">Código facebk</th>
                  <th className="px-3 py-2">ID da transação</th>
                  <th className="px-3 py-2 text-right">Valor (US$)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slice.map((r) => (
                  <tr key={r.transactionId}>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.data}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.conta ?? "—"}<span className="text-slate-400 text-xs"> · {r.accountId}</span></td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.bm ?? "—"}</td>
                    <td className="px-3 py-2 text-center">{r.hasPdf ? <span title="Possui PDF salvo">✅</span> : <span title="Sem PDF">🔴</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.facebk ? <span className="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">Facebk *{r.facebk}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-[11px] tabular-nums text-slate-500" title={r.transactionId}>{r.transactionId}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(r.usd)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Nenhuma cobrança Meta. Rode Sincronizar Meta.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3 text-xs text-slate-500">
              <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} de {rows.length}</span>
              <button className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ anterior</button>
              <span>{page}/{pages}</span>
              <button className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>próxima ›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-red-600" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
