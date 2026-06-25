"use client";

import { useState } from "react";

export default function ReceiptsImportPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/admin/import-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const j = await res.json();
      setMsg(res.ok ? `✅ Recebidos ${j.recebidos} · novos ${j.novos} · total no banco ${j.totalNoBanco}` : `❌ ${j.error ?? "erro"}`);
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-xl">
      <h1 className="text-xl font-semibold">Importar recibos (Meta)</h1>
      <p className="text-sm text-slate-500">
        Selecione o arquivo <code>receipts-parsed.json</code> (gerado localmente por <code>scripts/parse-receipts.mjs</code>).
        Ele carrega os recibos em <code>MetaReceipt</code> — o elo entre o código do extrato (<code>metaRef</code>) e a conta de anúncio.
      </p>
      <input
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        className="text-sm"
      />
      {busy && <p className="text-sm text-slate-500">Enviando…</p>}
      {msg && <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap">{msg}</pre>}
    </div>
  );
}
