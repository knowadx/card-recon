"use client";

import { useEffect, useRef, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type Category = { id: string; name: string; type: string; plSection?: string | null };
type Row = { name: string; byMonth: Record<string, number>; total: number };
type Data = { rows: Row[]; months: string[] };

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const COLORS = ["#6366f1","#f59e0b","#ef4444","#22c55e","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#00b9a5","#e11d48","#0ea5e9"];

function fmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function monthLabel(m: string) {
  const [, mm] = m.split("-");
  return MONTHS_SHORT[parseInt(mm) - 1];
}

export default function AnalyticsPage() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const defaultFrom = `${twelveAgo.getFullYear()}-${String(twelveAgo.getMonth() + 1).padStart(2, "0")}`;

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [catSearch, setCatSearch] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(thisMonth);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/categories").then(r => r.json()).then((cats: Category[]) => {
      const managerial = cats.filter(c => c.type === "MANAGERIAL" && !c.plSection);
      setCategories(managerial);
      if (managerial.length > 0) {
        setCategoryId(managerial[0].id);
        setCatSearch(managerial[0].name);
      }
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!categoryId || !from || !to) return;
    setLoading(true);
    fetch(`/api/analytics?categoryId=${categoryId}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then((d: Data) => { setData(d); setHiddenRows(new Set()); })
      .finally(() => setLoading(false));
  }, [categoryId, from, to]);

  const visibleRows = data?.rows.filter(r => !hiddenRows.has(r.name)) ?? [];

  const chartData = (data?.months ?? []).map(m => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const point: Record<string, any> = { month: monthLabel(m) };
    for (const row of visibleRows) {
      point[row.name] = row.byMonth[m] !== undefined ? Math.abs(row.byMonth[m]) : null;
    }
    return point;
  });

  const toggleRow = (name: string) =>
    setHiddenRows(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const presets = [
    { label: "This month", from: () => thisMonth, to: () => thisMonth },
    { label: "Last month", from: () => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }, to: () => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; } },
    { label: "This year", from: () => `${now.getFullYear()}-01`, to: () => `${now.getFullYear()}-12` },
    { label: "Last 12m", from: () => defaultFrom, to: () => thisMonth },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      {/* Header */}
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed] flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Analytics</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Cost evolution by transaction name</p>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Category combobox */}
          <div ref={catRef} className="relative">
            <div
              className={`flex items-center gap-2 h-9 px-3 bg-white border rounded-lg cursor-pointer transition-colors w-56 ${catOpen ? "border-[#00b9a5] ring-2 ring-[#00b9a5]/20" : "border-[#e8eaed] hover:border-[#d1d5db]"}`}
              onClick={() => { setCatOpen(v => !v); }}
            >
              <Search className="w-3.5 h-3.5 text-[#9ca3af] shrink-0" />
              <input
                className="flex-1 text-sm text-[#374151] bg-transparent focus:outline-none placeholder:text-[#9ca3af] min-w-0"
                placeholder="Search category..."
                value={catSearch}
                onChange={e => { setCatSearch(e.target.value); setCatOpen(true); }}
                onClick={e => { e.stopPropagation(); setCatOpen(true); }}
              />
              <ChevronDown className={`w-3.5 h-3.5 text-[#9ca3af] shrink-0 transition-transform ${catOpen ? "rotate-180" : ""}`} />
            </div>
            {catOpen && (
              <div className="absolute top-full mt-1 left-0 w-full bg-white border border-[#e8eaed] rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                {categories
                  .filter(c => c.name.toLowerCase().includes(catSearch.toLowerCase()))
                  .map(c => (
                    <button key={c.id}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${c.id === categoryId ? "bg-[#e6f7f5] text-[#00b9a5] font-medium" : "text-[#374151] hover:bg-[#f9fafb]"}`}
                      onClick={() => { setCategoryId(c.id); setCatSearch(c.name); setCatOpen(false); }}
                    >
                      {c.name}
                    </button>
                  ))}
                {categories.filter(c => c.name.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-sm text-[#9ca3af]">No categories found</p>
                )}
              </div>
            )}
          </div>
          {/* Presets */}
          <div className="flex items-center gap-1">
            {presets.map(({ label, from: f, to: t }) => {
              const isActive = from === f() && to === t();
              return (
                <button key={label} onClick={() => { setFrom(f()); setTo(t()); }}
                  className={`h-9 px-3 text-[13px] rounded-lg border font-medium transition-colors whitespace-nowrap ${isActive ? "border-[#00b9a5] bg-[#e6f7f5] text-[#00b9a5]" : "border-[#e8eaed] bg-white text-[#6b7280] hover:bg-[#f9fafb]"}`}>
                  {label}
                </button>
              );
            })}
          </div>
          {/* Date range */}
          <div className="flex items-center gap-1.5 bg-white border border-[#e8eaed] rounded-lg px-3 h-9">
            <input type="month" value={from} onChange={e => e.target.value && setFrom(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none" />
            <span className="text-[#d1d5db]">—</span>
            <input type="month" value={to} onChange={e => e.target.value && setTo(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && data && data.rows.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-16 text-center">
            <p className="text-[#9ca3af] text-sm">No transactions found for this category and period.</p>
          </div>
        )}

        {!loading && data && data.rows.length > 0 && (
          <>
            {/* Chart */}
            {visibleRows.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8eaed] p-6">
                <h2 className="text-[13px] font-semibold text-[#374151] mb-4">Evolution</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 0" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                      tickFormatter={v => fmt(v as number)} width={52} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, border: "1px solid #e8eaed", borderRadius: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                      formatter={(v, name) => [fmt(v as number), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    {visibleRows.slice(0, 12).map((row, i) => (
                      <Line key={row.name} type="monotone" dataKey={row.name}
                        stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                        dot={false} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider sticky left-0 bg-[#fafbfc] min-w-[220px] z-10">
                      Transaction
                    </th>
                    {data.months.map(m => (
                      <th key={m} className="px-3 py-3 text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider text-right whitespace-nowrap min-w-[72px]">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider text-right min-w-[80px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => {
                    const hidden = hiddenRows.has(row.name);
                    const color = COLORS[i % COLORS.length];
                    // Detect trend: compare last value to first non-null value
                    const vals = data.months.map(m => row.byMonth[m]).filter(v => v !== undefined) as number[];
                    const first = vals[0], last = vals[vals.length - 1];
                    const trend = vals.length >= 2 ? (Math.abs(last) - Math.abs(first)) / (Math.abs(first) || 1) : 0;

                    return (
                      <tr key={row.name}
                        className={`border-b border-[#f3f4f6] transition-colors ${hidden ? "opacity-40" : "hover:bg-[#fafbfc]"}`}>
                        <td className="px-5 py-3 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5">
                            <button onClick={() => toggleRow(row.name)}
                              className="w-3 h-3 rounded-full shrink-0 border-2 transition-all"
                              style={{ background: hidden ? "transparent" : color, borderColor: color }} />
                            <span className="text-[13px] font-medium text-[#374151] truncate max-w-[180px]" title={row.name}>
                              {row.name}
                            </span>
                            {vals.length >= 2 && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${trend > 0.05 ? "bg-rose-50 text-rose-500" : trend < -0.05 ? "bg-emerald-50 text-emerald-600" : "bg-[#f3f4f6] text-[#9ca3af]"}`}>
                                {trend > 0 ? "+" : ""}{(trend * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </td>
                        {data.months.map(m => {
                          const v = row.byMonth[m];
                          return (
                            <td key={m} className="px-3 py-3 text-right tabular-nums text-[13px] text-[#374151]">
                              {v !== undefined ? fmt(Math.abs(v)) : <span className="text-[#e8eaed]">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[#374151]">
                          {fmt(row.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
