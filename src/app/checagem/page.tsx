"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type MetaCharge = {
  id: string;
  transactionId: string;
  referenceNumber: string | null;
  date: string;
  amount: number;
  currency: string;
  account: string | null;
  accountId: string;
  bm: string | null;
  bmId: string | null;
  operation: string | null;
  fundingCard: string | null;
};
type Monthly = { month: string; metaUsd: number; bankUsd: number; diffUsd: number; metaCount: number; bankCount: number };
type BankAcct = { name: string; company: string | null; count: number; totalUsd: number; byMonth: Record<string, number> };
type MetaAcct = { name: string; accountId: string; bm: string | null; bmId: string | null; count: number; totalUsd: number; byMonth: Record<string, number> };
type Company = { id: string; name: string };
type AccountOpt = { id: string; name: string; company: string | null };
type Data = {
  companies?: Company[];
  accounts?: AccountOpt[];
  totals?: { metaUsd: number; bankUsd: number; diffUsd: number };
  monthly?: Monthly[];
  absMonths?: string[];
  bankByAccount?: BankAcct[];
  metaByAccount?: MetaAcct[];
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

  // filtros
  const [fOp, setFOp] = useState("");
  const [fBank, setFBank] = useState(""); // conta bancária (server-side)
  const [fMeta, setFMeta] = useState(""); // busca na tabela de cobranças do Meta (conta/BM)
  const [fCompany, setFCompany] = useState(""); // empresa (server-side)

  // janela de datas do sync (vazio = últimos 30 dias)
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  async function load() {
    const qs = new URLSearchParams();
    if (fCompany) qs.set("company", fCompany);
    if (fBank) qs.set("account", fBank);
    const q = qs.toString();
    setData(await fetch(`/api/checagem${q ? `?${q}` : ""}`).then((r) => r.json()));
  }
  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fCompany, fBank]);

  async function run(path: string, label: string, body?: Record<string, unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
      const text = await r.text();
      let j: Record<string, unknown> | null = null;
      try { j = JSON.parse(text); } catch { /* resposta não-JSON (timeout/erro de plataforma) */ }
      if (!j) {
        setMsg(`⏱️ ${label}: a função excedeu o tempo (janela grande). O progresso foi salvo — use uma janela de datas menor e rode de novo.`);
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

  // lista de operações p/ o dropdown (das cobranças do Meta)
  const operations = useMemo(() => {
    const set = new Set<string>();
    for (const m of data?.metaCharges ?? []) if (m.operation) set.add(m.operation);
    return Array.from(set).sort();
  }, [data]);

  // cobranças dentro do Meta: filtra por Operação + busca conta/BM
  const metaQ = fMeta.trim().toLowerCase();
  const metaChargesF = (data?.metaCharges ?? []).filter(
    (m) =>
      (!fOp || m.operation === fOp) &&
      (!metaQ || [m.account, m.accountId, m.bm, m.bmId, m.transactionId, m.referenceNumber].some((v) => v?.toLowerCase().includes(metaQ))),
  );

  const filtering = !!(fOp || fBank || fMeta || fCompany);
  const clearFilters = () => { setFOp(""); setFBank(""); setFMeta(""); setFCompany(""); };

  return (
    <div className="flex flex-col gap-5 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Checagem de gasto Meta</h1>
          <p className="text-sm text-slate-500">
            Compara o que o <strong>Meta diz</strong> que gastou com o que foi <strong>cobrado nas suas contas</strong>, mês a mês. Diferença grande = cobrança fora das contas que você controla.
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
        </div>
      </div>

      {msg && <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100">{msg}</pre>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Meta diz (US$)" value={money(data.totals?.metaUsd ?? 0, "USD")} />
            <Kpi label="Cobrado na conta (US$)" value={money(data.totals?.bankUsd ?? 0, "USD")} />
            <Kpi label="Diferença (US$)" value={money(data.totals?.diffUsd ?? 0, "USD")} warn={Math.abs(data.totals?.diffUsd ?? 0) >= 1} />
            <Kpi label="Contas Meta" value={String(data.metaAccounts)} />
          </div>

          {/* Barra de filtros */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Empresa
              <select className={input + " max-w-[200px]"} value={fCompany} onChange={(e) => setFCompany(e.target.value)}>
                <option value="">Todas</option>
                {(data.companies ?? []).map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Operação
              <select className={input} value={fOp} onChange={(e) => setFOp(e.target.value)}>
                <option value="">Todas</option>
                {operations.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Conta
              <select className={input + " max-w-[220px]"} value={fBank} onChange={(e) => setFBank(e.target.value)}>
                <option value="">Todas</option>
                {(data.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.company ? `${a.company} · ` : ""}{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Conta/BM (Meta)
              <input className={input + " min-w-[160px]"} placeholder="nome ou ID da conta/BM" value={fMeta} onChange={(e) => setFMeta(e.target.value)} />
            </label>
            {filtering && (
              <button className="text-xs text-indigo-600 hover:underline pb-1.5" onClick={clearFilters}>limpar filtros</button>
            )}
          </div>

          {/* Comparação mensal — Meta diz × cobrado na conta × diferença */}
          {(data.monthly?.length ?? 0) > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Comparação mensal</h2>
              <p className="text-xs text-slate-500">Soma bruta em USD, sem casar nada. Gasto que o Meta reporta × gasto cobrado nas contas.</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Mês</th>
                      <th className="px-3 py-2 text-right" title="Nº de cobranças que o Meta reporta">Cobr. Meta</th>
                      <th className="px-3 py-2 text-right" title="Soma das cobranças do Meta (USD)">Meta diz (US$)</th>
                      <th className="px-3 py-2 text-right" title="Nº de cobranças no extrato">Cobr. conta</th>
                      <th className="px-3 py-2 text-right" title="Soma cobrada nas contas (USD)">Cobrado na conta (US$)</th>
                      <th className="px-3 py-2 text-right" title="Conta − Meta (USD)">Diferença</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.monthly!.map((m) => (
                      <tr key={m.month}>
                        <td className="px-3 py-2 tabular-nums">{m.month}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m.metaCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{money(m.metaUsd, "USD")}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m.bankCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{money(m.bankUsd, "USD")}</td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${Math.abs(m.diffUsd) < 1 ? "text-slate-400" : "text-red-600 font-semibold"}`}>{money(m.diffUsd, "USD")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Valor absoluto por conta — quebra dos dois lados */}
          {((data.bankByAccount?.length ?? 0) > 0 || (data.metaByAccount?.length ?? 0) > 0) && (() => {
            const months = data.absMonths ?? [];
            const bank = data.bankByAccount ?? [];
            const meta = data.metaByAccount ?? [];
            const bankTotByMonth = (m: string) => bank.reduce((s, r) => s + (r.byMonth[m] ?? 0), 0);
            const metaTotByMonth = (m: string) => meta.reduce((s, r) => s + (r.byMonth[m] ?? 0), 0);
            const bankTotal = bank.reduce((s, r) => s + r.totalUsd, 0);
            const metaTotal = meta.reduce((s, r) => s + r.totalUsd, 0);
            return (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-slate-700">Detalhe por conta</h2>

                {/* Lado banco */}
                <h3 className="text-xs font-semibold text-slate-600 mt-1">Cobrado nas contas bancárias (extrato)</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Conta</th>
                        <th className="px-3 py-2 text-right">Cobranças</th>
                        {months.map((m) => <th key={m} className="px-3 py-2 text-right whitespace-nowrap">{m} (US$)</th>)}
                        <th className="px-3 py-2 text-right">Total (US$)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bank.map((r) => (
                        <tr key={r.name + (r.company ?? "")}>
                          <td className="px-3 py-2 whitespace-nowrap">{r.name}{r.company ? <span className="text-slate-400"> · {r.company}</span> : null}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                          {months.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{r.byMonth[m] ? money(r.byMonth[m], "USD") : "—"}</td>)}
                          <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{money(r.totalUsd, "USD")}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{bank.reduce((s, r) => s + r.count, 0)}</td>
                        {months.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(bankTotByMonth(m), "USD")}</td>)}
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(bankTotal, "USD")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Lado Meta */}
                <h3 className="text-xs font-semibold text-slate-600 mt-2">Cobranças por conta de anúncio (Meta)</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Conta de anúncio</th>
                        <th className="px-3 py-2">BM</th>
                        <th className="px-3 py-2 text-right">Cobranças</th>
                        {months.map((m) => <th key={m} className="px-3 py-2 text-right whitespace-nowrap">{m} (US$)</th>)}
                        <th className="px-3 py-2 text-right">Total (US$)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {meta.map((r) => (
                        <tr key={r.accountId}>
                          <td className="px-3 py-2 whitespace-nowrap">{r.name}<span className="text-slate-400 text-xs tabular-nums"> · {r.accountId}</span></td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{r.bm ?? "—"}{r.bmId ? <span className="text-slate-400"> · {r.bmId}</span> : null}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                          {months.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{r.byMonth[m] ? money(r.byMonth[m], "USD") : "—"}</td>)}
                          <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{money(r.totalUsd, "USD")}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{meta.reduce((s, r) => s + r.count, 0)}</td>
                        {months.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(metaTotByMonth(m), "USD")}</td>)}
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(metaTotal, "USD")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}

          {/* Cobranças reais DENTRO do Meta (act/activities) */}
          <PagedSection
            title={`🔵 Cobranças dentro do Meta (${metaChargesF.length}${filtering ? ` de ${data.metaChargeCount ?? data.metaCharges?.length ?? 0}` : ` — ${data.metaChargeCount ?? 0} no total`})`}
            note="As cobranças que o Meta reporta por conta/BM. A cobrança em si NÃO traz cartão (a Meta não expõe); o 'Cartão (funding)' é o cartão primário da conta — referência."
            empty={(data.metaCharges?.length ?? 0) === 0 ? "Nenhuma cobrança Meta ainda. Rode Sincronizar Meta." : "Nenhum resultado para o filtro."}
            rows={metaChargesF}
            border="border-sky-200"
            head={
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2" title="Código do recibo = o 'Facebk *XXXX' que aparece no extrato">Código</th>
                <th className="px-3 py-2">ID da cobrança</th>
                <th className="px-3 py-2">Conta de anúncio</th>
                <th className="px-3 py-2">Account ID</th>
                <th className="px-3 py-2">BM</th>
                <th className="px-3 py-2">BM ID</th>
                <th className="px-3 py-2">Operação</th>
                <th className="px-3 py-2">Cartão (funding)</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            }
            headClass="bg-sky-50 text-sky-700"
            row={(m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 tabular-nums">{m.date}</td>
                <td className="px-3 py-2 text-xs font-mono tabular-nums">{m.referenceNumber ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-slate-500" title={m.transactionId}>
                  {m.transactionId.includes("-")
                    ? m.transactionId.split("-").map((part, i) => (
                        <div key={i}><span className="text-slate-300">{i === 0 ? "A" : "B"}:</span> {part}</div>
                      ))
                    : m.transactionId}
                </td>
                <td className="px-3 py-2 text-xs">{m.account ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{m.accountId}</td>
                <td className="px-3 py-2 text-xs">{m.bm ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{m.bmId ?? "—"}</td>
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

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
