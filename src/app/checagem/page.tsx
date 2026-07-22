"use client";

import { useEffect, useState } from "react";

type Cell = { qtde: number; usd: number };
type MesRow = { mes: string; ok: Cell; codigoSemPdf: Cell; semCodigo: Cell };
type CardRow = { cartao: string; bank: string | null; qtde: number; usd: number };
type Company = { id: string; name: string };
type AccountOpt = { id: string; name: string; company: string | null };
type Data = {
  piso?: string;
  mesesDisponiveis?: string[];
  companies?: Company[];
  accounts?: AccountOpt[];
  vazamento?: { total: { ok: Cell; codigoSemPdf: Cell; semCodigo: Cell }; porMes: MesRow[]; porCartao: CardRow[] };
};

function money(n: number) {
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChecagemPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [fCompany, setFCompany] = useState("");
  const [fBank, setFBank] = useState("");
  const [fMonth, setFMonth] = useState("");

  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  useEffect(() => {
    fetch("/api/settings/sync-period").then((r) => r.json())
      .then((p) => { setSyncFrom(p.from ?? ""); setSyncTo(p.to ?? ""); }).catch(() => {});
  }, []);

  async function load() {
    const qs = new URLSearchParams();
    if (fCompany) qs.set("company", fCompany);
    if (fBank) qs.set("account", fBank);
    if (fMonth) qs.set("month", fMonth);
    const q = qs.toString();
    setData(await fetch(`/api/checagem${q ? `?${q}` : ""}`).then((r) => r.json()));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fCompany, fBank, fMonth]);

  async function savePeriod() {
    setBusy("Salvar período"); setMsg(null);
    try {
      const r = await fetch("/api/settings/sync-period", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: syncFrom, to: syncTo || undefined }) });
      const j = await r.json();
      if (!r.ok) { setMsg(`❌ ${j.error}`); return; }
      setSyncFrom(j.from ?? ""); setSyncTo(j.to ?? "");
      setMsg(`✅ Período salvo: ${j.from} → ${j.to || "hoje"}. Limita a análise; os syncs sempre importam até hoje.`);
      await load();
    } catch (e) { setMsg(`❌ ${(e as Error).message}`); } finally { setBusy(null); }
  }

  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  const v = data?.vazamento;
  const semFaturaQtde = (v?.total.codigoSemPdf.qtde ?? 0) + (v?.total.semCodigo.qtde ?? 0);
  const semFaturaUsd = (v?.total.codigoSemPdf.usd ?? 0) + (v?.total.semCodigo.usd ?? 0);

  return (
    <div className="flex flex-col gap-5 p-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Checagem de vazamento</h1>
          <p className="text-sm text-slate-500 max-w-xl">
            Toda cobrança Meta no <strong>extrato</strong> precisa ter <strong>código facebk</strong> e <strong>PDF salvo</strong>. Sem PDF = <strong className="text-red-600">possível vazamento</strong>. As cobranças do Meta ficam na aba <strong>Cobranças Meta</strong>.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">início
              <input type="date" className={input} value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">fim (vazio = hoje)
              <input type="date" className={input} value={syncTo} onChange={(e) => setSyncTo(e.target.value)} /></label>
            <button className={btn} disabled={busy !== null || !syncFrom} onClick={savePeriod}>{busy === "Salvar período" ? "Salvando…" : "Salvar período"}</button>
          </div>
          <p className="text-[11px] text-slate-400">Período de <strong>análise</strong> (Checagem + Cobranças Meta). O <strong>fim</strong> não trava importação — syncs sempre vão até hoje.</p>
        </div>
      </div>

      {msg && <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100 whitespace-pre-wrap">{msg}</pre>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="✅ Com fatura" value={String(v?.total.ok.qtde ?? 0)} sub={money(v?.total.ok.usd ?? 0)} />
            <Kpi label="🔴 Código sem PDF" value={String(v?.total.codigoSemPdf.qtde ?? 0)} sub={money(v?.total.codigoSemPdf.usd ?? 0)} warn={(v?.total.codigoSemPdf.qtde ?? 0) > 0} />
            <Kpi label="🔴 Sem código" value={String(v?.total.semCodigo.qtde ?? 0)} sub={money(v?.total.semCodigo.usd ?? 0)} warn={(v?.total.semCodigo.qtde ?? 0) > 0} />
            <Kpi label="Total Meta no extrato" value={String((v?.total.ok.qtde ?? 0) + semFaturaQtde)} sub={money((v?.total.ok.usd ?? 0) + semFaturaUsd)} />
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">Mês
              <select className={input} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                <option value="">Todos</option>
                {(data.mesesDisponiveis ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Empresa
              <select className={input + " max-w-[200px]"} value={fCompany} onChange={(e) => setFCompany(e.target.value)}>
                <option value="">Todas</option>
                {(data.companies ?? []).map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Conta
              <select className={input + " max-w-[220px]"} value={fBank} onChange={(e) => setFBank(e.target.value)}>
                <option value="">Todas</option>
                {(data.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.company ? `${a.company} · ` : ""}{a.name}</option>)}
              </select></label>
            <a href="/transactions" className="ml-auto text-xs text-indigo-600 hover:underline pb-1.5">ver no extrato (filtro &ldquo;Sem fatura 🔴&rdquo;) →</a>
          </div>

          {/* Por mês */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Por mês (cobranças Meta no extrato)</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Mês</th>
                    <th className="px-3 py-2 text-right">✅ Com fatura</th>
                    <th className="px-3 py-2 text-right">🔴 Código sem PDF</th>
                    <th className="px-3 py-2 text-right">🔴 Sem código</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(v?.porMes ?? []).map((r) => (
                    <tr key={r.mes}>
                      <td className="px-3 py-2 tabular-nums">{r.mes}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.ok.qtde}<span className="text-slate-400 text-xs"> · {money(r.ok.usd)}</span></td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.codigoSemPdf.qtde ? "text-red-600 font-medium" : "text-slate-400"}`}>{r.codigoSemPdf.qtde}<span className="text-slate-400 text-xs"> · {money(r.codigoSemPdf.usd)}</span></td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.semCodigo.qtde ? "text-red-600 font-medium" : "text-slate-400"}`}>{r.semCodigo.qtde}<span className="text-slate-400 text-xs"> · {money(r.semCodigo.usd)}</span></td>
                    </tr>
                  ))}
                  {(v?.porMes?.length ?? 0) === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhuma cobrança Meta no período.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">🔴 Código sem PDF = conta de origem fora do seu controle. 🔴 Sem código = cobrança Meta sem facebk (re-sincronize Revolut/importe o CSV se for do mês em aberto).</p>
          </section>

          {/* 🔴 por cartão */}
          {(v?.porCartao?.length ?? 0) > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">🔴 Sem fatura — por cartão</h2>
              <div className="overflow-x-auto rounded-lg border border-red-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 text-left text-xs uppercase text-red-700">
                    <tr>
                      <th className="px-3 py-2">Cartão</th>
                      <th className="px-3 py-2">Banco</th>
                      <th className="px-3 py-2 text-right">Cobranças</th>
                      <th className="px-3 py-2 text-right">Valor (US$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {v!.porCartao.map((c) => (
                      <tr key={c.cartao}>
                        <td className="px-3 py-2 tabular-nums">•••• {c.cartao}</td>
                        <td className="px-3 py-2 text-slate-500">{c.bank ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.qtde}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(c.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
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
