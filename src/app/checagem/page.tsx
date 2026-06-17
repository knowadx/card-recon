"use client";

import { useEffect, useState } from "react";

type Tx = {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  cardLast4: string | null;
  account: string | null;
  company: string | null;
  validatedBy?: string | null;
};
type WL = { id: string; last4: string; label: string | null; company: string | null };
type Combo = { last4: string | null; account: string | null; accountId: string | null; bm: string | null; source: string };
type Data = {
  counts: { leak: number; review: number; ok: number };
  leak: Tx[];
  review: Tx[];
  okSample?: Tx[];
  combos?: Combo[];
  metaAccounts: number;
  whitelist: WL[];
};

function money(n: number, c: string) {
  return `${c} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChecagemPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

          {/* Vazamentos */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-700">🔴 Cobranças suspeitas ({data.leak.length})</h2>
            {data.leak.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Nenhuma cobrança Meta fora das suas contas. 👍
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-red-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 text-left text-xs uppercase text-red-700">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Empresa / Conta</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Cartão</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.leak.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 tabular-nums">{t.date}</td>
                        <td className="px-3 py-2 text-xs">{t.company ?? "—"}<div className="text-slate-400">{t.account}</div></td>
                        <td className="px-3 py-2">{t.description}</td>
                        <td className="px-3 py-2 text-xs">{t.cardLast4 ? `•••• ${t.cardLast4}` : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(t.amount, t.currency)}</td>
                        <td className="px-3 py-2 text-right">
                          {t.cardLast4 && (
                            <button className="text-xs text-indigo-600 hover:underline" onClick={() => whitelistCard(t.cardLast4!)}>
                              marcar cartão como meu
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* A revisar */}
          {data.review.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">⚪ A revisar — cobrança Meta sem cartão identificado ({data.review.length})</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {data.review.slice(0, 50).map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 tabular-nums">{t.date}</td>
                        <td className="px-3 py-2 text-xs">{t.company ?? "—"}</td>
                        <td className="px-3 py-2">{t.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(t.amount, t.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Combinações validadas (cartão → conta/BM) */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Combinações validadas — cartão → Conta/BM ({data.combos?.length ?? 0})</h2>
            <p className="text-xs text-slate-500">Cartão que financia uma conta de anúncio que você controla (auto, via token Meta) ou marcado manualmente. Cobrança nesses cartões entra como segura automaticamente.</p>
            {(data.combos?.length ?? 0) > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Cartão</th><th className="px-3 py-2">Conta (Account ID)</th><th className="px-3 py-2">BM</th><th className="px-3 py-2">Origem</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.combos!.map((c, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">•••• {c.last4}</td>
                        <td className="px-3 py-2 text-xs">{c.account ?? "—"}{c.accountId ? ` (${c.accountId})` : ""}</td>
                        <td className="px-3 py-2 text-xs">{c.bm ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{c.source === "meta" ? "Meta (funding)" : "manual"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                Nenhuma combinação ainda. Rode <strong>Sync contas Meta</strong> (com tokens que exponham o funding) — aí cada cartão→conta/BM vira uma combinação validada.
              </p>
            )}
          </section>

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

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
