"use client";

import { useEffect, useRef, useState } from "react";

type Row = { file: string; referenceNumber: string | null; transactionId: string | null; accountId: string | null; accountName: string | null; cardLast4: string | null; amountUsd: number | null; date: string | null };

const field = (text: string, re: RegExp) => { const m = text.match(re); return m ? m[1] : null; };

function parseRow(fileName: string, text: string): Row {
  const txId = field(fileName, /#\s*([0-9]+-[0-9]+)/) || field(text, /Identifica[çc][ãa]o da transa[çc][ãa]o\s*([0-9]+-[0-9]+)/);
  const fnDate = fileName.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  const date = fnDate ? `${fnDate[1]}-${fnDate[2]}-${fnDate[3]}T${fnDate[4]}:${fnDate[5]}:00Z` : null;
  const referenceNumber = field(text, /N[úu]mero de refer[êe]ncia:\s*([A-Za-z0-9]+)/);
  const accountId = field(text, /N[úu]mero de identifica[çc][ãa]o da conta:\s*([0-9]+)/);
  const accountName = field(text, /Fatura para\s+(.+)/);
  const cardLast4 = field(text, /(?:MasterCard|Mastercard|Visa|American Express|Amex)[^\d]*(\d{4})/i) || field(text, /[·•]{2,}\s*(\d{4})/);
  const amountStr = field(text, /Pago\s*US\$\s*([\d.]*\d,\d{2})/) || field(text, /US\$\s*([\d.]*\d,\d{2})/);
  const amountUsd = amountStr ? Number(amountStr.replace(/\./g, "").replace(",", ".")) : null;
  return { file: fileName, referenceNumber, transactionId: txId, accountId, accountName, cardLast4, amountUsd, date };
}

/** Lê os PDFs de uma pasta no navegador (pdfjs), mostra amostra e importa+cruza. */
export default function ReceiptsImporter({ onImported }: { onImported?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "ready" | "importing" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (inputRef.current) { inputRef.current.setAttribute("webkitdirectory", ""); inputRef.current.setAttribute("directory", ""); }
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (all.length === 0) { setResult("Nenhum PDF encontrado na pasta."); return; }
    setPhase("reading"); setResult(null); setProgress({ done: 0, total: all.length, errors: 0 }); setRows([]);

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const out: Row[] = [];
    let errors = 0;
    for (let i = 0; i < all.length; i++) {
      try {
        const data = new Uint8Array(await all[i].arrayBuffer());
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        let text = "";
        for (let p = 1; p <= doc.numPages; p++) {
          const content = await (await doc.getPage(p)).getTextContent();
          for (const it of content.items) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item = it as any;
            if (typeof item.str === "string") text += item.str + (item.hasEOL ? "\n" : " ");
          }
          text += "\n";
        }
        await doc.destroy();
        out.push(parseRow(all[i].name, text));
      } catch { errors++; }
      if (i % 5 === 0 || i === all.length - 1) setProgress({ done: i + 1, total: all.length, errors });
    }
    setRows(out); setProgress({ done: all.length, total: all.length, errors }); setPhase("ready");
  }

  async function importar() {
    setPhase("importing"); setResult(null);
    try {
      const res = await fetch("/api/admin/import-receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
      const j = await res.json();
      setResult(res.ok
        ? `✅ Importado e cruzado! · recibos: ${j.recebidos} · no banco: ${j.inseridos} · COM fatura: ${j.comFatura} · SEM fatura: ${j.metaSemFatura}`
        : `❌ ${j.error ?? "erro"}`);
      setPhase("done");
      if (res.ok) onImported?.();
    } catch (e) { setResult(`❌ ${(e as Error).message}`); setPhase("ready"); }
  }

  const comCodigo = rows.filter((r) => r.referenceNumber).length;
  const preview = rows.slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" multiple accept="application/pdf,.pdf" disabled={phase === "reading" || phase === "importing"} onChange={onPick} className="text-sm" />
      <p className="text-[12px] text-slate-400">Escolha a pasta com os PDFs (lê subpastas). Nada é enviado — o navegador lê aqui e manda só o resultado.</p>

      {phase === "reading" && (
        <div>
          <div className="text-sm text-slate-700 mb-1">Lendo PDFs… {progress.done}/{progress.total}</div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        </div>
      )}

      {(phase === "ready" || phase === "importing" || phase === "done") && rows.length > 0 && (
        <>
          <div className="text-sm text-slate-600">{rows.length} PDFs lidos · <strong>{comCodigo}</strong> com código{progress.errors > 0 ? ` · ${progress.errors} ilegíveis` : ""}</div>
          <div className="overflow-x-auto rounded border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">Código</th><th className="px-2 py-1">Conta</th><th className="px-2 py-1">US$</th><th className="px-2 py-1">Data</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 font-mono">{r.referenceNumber ?? <span className="text-red-400">— vazio</span>}</td>
                    <td className="px-2 py-1">{r.accountName ?? "—"}</td>
                    <td className="px-2 py-1 tabular-nums">{r.amountUsd ?? "—"}</td>
                    <td className="px-2 py-1 tabular-nums">{r.date?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={importar} disabled={phase === "importing"} className="self-start rounded-md bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {phase === "importing" ? "Importando e cruzando…" : `Importar e cruzar ${rows.length} recibos`}
          </button>
        </>
      )}

      {result && <pre className="rounded-md bg-slate-900 p-2 text-xs text-slate-100 whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}
