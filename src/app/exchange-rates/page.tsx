"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Check, Download } from "lucide-react";

type Rate = { id: string; currency: string; month: string; rateToUsd: number };

function monthsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return result;
}

function fmtMonth(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

export default function ExchangeRatesPage() {
  const now = new Date();
  const defaultFrom = `${now.getFullYear() - 2}-01`;
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({}); // key: `${currency}:${month}`
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);

  const months = monthsBetween(from, to);

  const load = useCallback(() => {
    fetch("/api/exchange-rates")
      .then(r => r.json())
      .then((data: { rates: Rate[]; currencies: string[] }) => {
        setCurrencies(data.currencies);
        const initial: Record<string, string> = {};
        for (const r of data.rates) {
          initial[`${r.currency}:${r.month}`] = String(r.rateToUsd);
        }
        setCells(initial);
        setDirty(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCell = (currency: string, month: string, val: string) => {
    setCells(prev => ({ ...prev, [`${currency}:${month}`]: val }));
    setDirty(true);
    setSaved(false);
  };

  const saveAll = async () => {
    setSaving(true);
    const rates = [];
    for (const currency of currencies) {
      for (const month of months) {
        const raw = cells[`${currency}:${month}`];
        if (!raw || raw.trim() === "") continue;
        const num = parseFloat(raw);
        if (!isNaN(num) && num > 0) rates.push({ currency, month, rateToUsd: num });
      }
    }
    await fetch("/api/exchange-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rates }),
    });
    setSaving(false);
    setSaved(true);
    setDirty(false);
  };

  const fetchFromWise = async () => {
    setFetching(true);
    setFetchResult(null);
    const res = await fetch("/api/exchange-rates/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currencies, from, to }),
    });
    const data = await res.json();
    const msg = data.error
      ? `Error: ${data.error}`
      : `Fetched ${data.fetched}/${data.total}${data.failed > 0 ? `, ${data.failed} failed` : ""}${data.errors?.length ? ` — ${data.errors[0]}` : ""}`;
    setFetchResult(msg);
    setFetching(false);
    load();
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Exchange Rates</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Monthly USD rates for multi-currency reporting</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={from} onChange={e => setFrom(e.target.value)}
            className="h-9 text-sm border border-[#e8eaed] rounded-lg px-3 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30" />
          <span className="text-[#9ca3af] text-sm">→</span>
          <input type="month" value={to} onChange={e => setTo(e.target.value)}
            className="h-9 text-sm border border-[#e8eaed] rounded-lg px-3 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30" />

          <button onClick={fetchFromWise} disabled={fetching}
            className="h-9 px-4 text-sm rounded-lg font-semibold flex items-center gap-2 bg-white border border-[#e8eaed] text-[#374151] hover:bg-[#f9fafb] transition-colors disabled:opacity-50">
            {fetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {fetching ? "Fetching..." : "Fetch from Wise"}
          </button>

          <button onClick={saveAll} disabled={!dirty || saving}
            className={`h-9 px-4 text-sm rounded-lg font-semibold flex items-center gap-2 transition-colors ${
              saved && !dirty ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
              : dirty ? "bg-[#00b9a5] hover:bg-[#00a896] text-white"
              : "bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed"
            }`}>
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : saved && !dirty ? <Check className="w-3.5 h-3.5" /> : null}
            {saving ? "Saving..." : saved && !dirty ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Coverage indicator */}
      {currencies.length > 0 && (() => {
        const missing = currencies.flatMap(c => months.filter(m => !cells[`${c}:${m}`]));
        if (missing.length === 0) return null;
        return (
          <div className="px-8 py-2 bg-amber-50 border-b border-amber-100 text-[13px] text-amber-700 flex items-center gap-2">
            <span className="font-semibold">{missing.length} missing</span>
            <span className="text-amber-500">— some months have no exchange rate. Reports will fall back to original currency.</span>
          </div>
        );
      })()}

      {fetchResult && (
        <div className="px-8 py-2 bg-emerald-50 border-b border-emerald-100 text-[13px] text-emerald-700">
          {fetchResult}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-white border-b border-[#e8eaed] z-10">
            <tr>
              <th className="text-left px-6 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-28">Currency</th>
              {months.map(m => (
                <th key={m} className="text-center px-2 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider min-w-[90px]">
                  {fmtMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* USD row — always 1.0, read-only */}
            <tr className="border-b border-[#f3f4f6] bg-[#f8fafc]">
              <td className="px-6 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#374151]">USD</span>
                  <span className="text-[10px] text-[#9ca3af] bg-[#e8eaed] px-1.5 py-0.5 rounded">base</span>
                </div>
              </td>
              {months.map(month => (
                <td key={month} className="px-1 py-1 text-center">
                  <span className="text-[13px] text-[#9ca3af] tabular-nums">1.0000</span>
                </td>
              ))}
            </tr>

            {currencies.map((currency, ci) => (
              <tr key={currency} className={`border-b border-[#f3f4f6] ${ci % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"} hover:bg-[#f0fdf9] transition-colors`}>
                <td className="px-6 py-2">
                  <span className="text-[13px] font-semibold text-[#374151]">{currency}</span>
                </td>
                {months.map(month => {
                  const key = `${currency}:${month}`;
                  const val = cells[key] ?? "";
                  return (
                    <td key={month} className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.0001"
                        value={val}
                        onChange={e => handleCell(currency, month, e.target.value)}
                        placeholder="—"
                        className={`w-full h-8 text-center text-[13px] border rounded-lg bg-transparent hover:border-[#e8eaed] focus:border-[#00b9a5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/20 transition-all tabular-nums ${
                          val ? "border-transparent text-[#374151]" : "border-amber-200 bg-amber-50/50 text-[#d1d5db]"
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
