"use client";

import { useState } from "react";

export default function RevolutCsvImportPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/admin/import-revolut-csv", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const j = await res.json();
      setMsg(res.ok
        ? `✅ ${j.metaRefGravados} código(s) gravado(s)\n· linhas no CSV: ${j.linhasCsv}\n· linhas com Facebk no CSV: ${j.linhasComCodigoNoCsv}\n· transações Revolut no banco: ${j.transacoesRevolutNoBanco}\n· já tinham o código: ${j.jaTinhamOMesmoCodigo}`
        : `❌ ${j.error ?? "erro"}`);
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-xl">
      <h1 className="text-xl font-semibold">Enriquecer Revolut (código do extrato)</h1>
      <p className="text-sm text-slate-500">
        A API da Revolut não traz o descritor <code>Facebk *XXXX</code> (ela limpa pra &quot;Meta Pay&quot;);
        o <strong>extrato CSV</strong> traz, na coluna <code>Description</code>. Suba o CSV do mês — isso
        <strong> só preenche o <code>metaRef</code></strong> das transações que a API já importou, casando
        pelo <code>ID</code> (UUID). Não cria nem duplica transação. Pode rodar quantas vezes quiser.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        className="text-sm"
      />
      {busy && <p className="text-sm text-slate-500">Enviando…</p>}
      {msg && <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap">{msg}</pre>}
    </div>
  );
}
