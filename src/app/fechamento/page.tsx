"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReceiptsImporter from "@/components/receipts-importer";

type Passo = { feito: boolean };
type Data = {
  mesesDisponiveis?: string[];
  month?: string | null;
  passos?: {
    bancos: Passo & { transacoesMeta: number };
    revolutCsv: Passo & { semCodigo: number };
    meta: Passo & { cobrancas: number };
    faturas: Passo & { comFatura: number; semFatura: number };
  };
  resultado?: { totalMeta: number; semFatura: number; comFatura: number };
};

export default function FechamentoPage() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load(m = month) {
    const d: Data = await fetch(`/api/fechamento${m ? `?month=${m}` : ""}`).then((r) => r.json());
    setData(d);
    if (!m && d.month) setMonth(d.month);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (month) load(month); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);

  async function run(label: string, fn: () => Promise<Response>) {
    setBusy(label); setMsg(null);
    try {
      const r = await fn();
      const text = await r.text(); let j: Record<string, unknown> | null = null;
      try { j = JSON.parse(text); } catch { /* não-JSON = timeout */ }
      setMsg(!j ? `⏱️ ${label}: excedeu o tempo (janela grande). Progresso salvo — rode de novo.` : (j.ok === false || j.error) ? `❌ ${j.error}` : `✅ ${label}: ${JSON.stringify(j).slice(0, 300)}`);
      await load(month);
    } catch (e) { setMsg(`❌ ${(e as Error).message}`); } finally { setBusy(null); }
  }

  function syncBancos() {
    return run("Sincronizar bancos", () => fetch("/api/sync/all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  }
  function syncMeta() {
    const [y, mo] = month.split("-").map(Number);
    const to = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
    return run("Sincronizar Meta", () => fetch("/api/meta/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `${month}-01`, to }) }));
  }
  async function onCsv(file: File) {
    setBusy("CSV Revolut"); setMsg(null);
    try {
      const r = await fetch("/api/admin/import-revolut-csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
      const j = await r.json();
      setMsg(r.ok ? `✅ CSV: ${j.metaRefGravados} código(s) gravado(s)` : `❌ ${j.error}`);
      await load(month);
    } catch (e) { setMsg(`❌ ${(e as Error).message}`); } finally { setBusy(null); }
  }

  const p = data?.passos;
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4 p-2 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Fechamento do mês</h1>
          <p className="text-sm text-slate-500">Os passos na ordem certa. Faça de cima pra baixo — o PDF por último.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-500">mês
          <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {(data?.mesesDisponiveis ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      {msg && <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100 whitespace-pre-wrap">{msg}</pre>}

      <Step n={1} title="Bancos (Wise / Revolut / Mercury)" feito={p?.bancos.feito} status={`${p?.bancos.transacoesMeta ?? 0} cobranças Meta no extrato`}>
        <button className={btn} disabled={busy !== null} onClick={syncBancos}>{busy === "Sincronizar bancos" ? "Sincronizando…" : "Sincronizar bancos"}</button>
      </Step>

      <Step n={2} title="Código Revolut (CSV do mês)" feito={p?.revolutCsv.feito} status={p && p.revolutCsv.semCodigo > 0 ? `${p.revolutCsv.semCodigo} cobranças Revolut sem código` : "todas com código"}>
        <label className={btn + " cursor-pointer"}>
          {busy === "CSV Revolut" ? "Importando…" : "Subir CSV da Revolut"}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); }} />
        </label>
      </Step>

      <Step n={3} title="Cobranças Meta (só este mês)" feito={p?.meta.feito} status={`${p?.meta.cobrancas ?? 0} cobranças do Meta`}>
        <button className={btn} disabled={busy !== null || !month} onClick={syncMeta}>{busy === "Sincronizar Meta" ? "Sincronizando…" : "Sincronizar Meta"}</button>
      </Step>

      <Step n={4} title="Faturas (PDFs) — por último" feito={p?.faturas.feito} status={p && p.faturas.semFatura > 0 ? `${p.faturas.semFatura} sem fatura 🔴 · ${p.faturas.comFatura} com fatura` : `${p?.faturas.comFatura ?? 0} com fatura`}>
        <ReceiptsImporter onImported={() => load(month)} />
      </Step>

      {data?.resultado && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div className="text-sm">
            <div className="text-slate-500 text-xs">Resultado de {month}</div>
            <div className="mt-1"><strong>{data.resultado.totalMeta}</strong> cobranças Meta · <strong className={data.resultado.semFatura > 0 ? "text-red-600" : "text-emerald-600"}>{data.resultado.semFatura} sem fatura 🔴</strong></div>
          </div>
          <Link href="/checagem" className="text-sm text-indigo-600 hover:underline">Ver Checagem →</Link>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, feito, status, children }: { n: number; title: string; feito?: boolean; status: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${feito ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{feito ? "✓" : n}</span>
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-800">{title}</div>
          <div className={`text-xs ${feito ? "text-emerald-600" : "text-slate-400"}`}>{status}</div>
        </div>
      </div>
      <div className="pl-9">{children}</div>
    </div>
  );
}
