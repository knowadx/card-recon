"use client";

import React, { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type Company = { id: string; name: string; color: string };
type PlRow = { id: string; name: string; plSection: string | null; values: Record<string, number>; total: number };
type UncatRow = { values: Record<string, number>; total: number; count: number };
type PlData = { months: string[]; rows: PlRow[]; uncategorizedRow: UncatRow | null };

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtMonth(m: string) {
  const [y, mo] = m.split("-");
  return `${MONTHS_SHORT[Number(mo) - 1]} ${y.slice(2)}`;
}

function fmtUsd(n: number) {
  if (n === 0) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function Cell({ value }: { value: number }) {
  if (value === 0) return <span className="text-[#d1d5db]">—</span>;
  const pos = value > 0;
  return (
    <span className={`tabular-nums font-medium ${pos ? "text-emerald-600" : "text-rose-500"}`}>
      {fmtUsd(value)}
    </span>
  );
}

export default function PlPage() {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-01`;
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("all");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<PlData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetch("/api/companies").then(r => r.json()).then(setCompanies); }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    if (companyId !== "all") params.set("companyId", companyId);
    fetch(`/api/pl?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [companyId, from, to]);

  const months = data?.months ?? [];
  const rows = data?.rows ?? [];
  const uncategorizedRow = data?.uncategorizedRow ?? null;

  // Split into sections
  const internal = rows.filter(r => r.plSection === "internal");
  const vat = rows.filter(r => r.plSection === "vat");
  const outside = rows.filter(r => r.plSection === "outside");
  const costsPassed = rows.filter(r => r.plSection === "costs-passed");
  const revenue = rows.filter(r => !r.plSection && r.total >= 0);
  const expenses = rows.filter(r => !r.plSection && r.total < 0);

  // Column totals
  const revenueByMonth = Object.fromEntries(months.map(m => [m, revenue.reduce((s, r) => s + (r.values[m] ?? 0), 0)]));
  const expensesByMonth = Object.fromEntries(months.map(m => [m, expenses.reduce((s, r) => s + (r.values[m] ?? 0), 0)]));
  const netByMonth = Object.fromEntries(months.map(m => [m, (revenueByMonth[m] ?? 0) + (expensesByMonth[m] ?? 0)]));

  const totalRevenue = revenue.reduce((s, r) => s + r.total, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.total, 0);
  const totalNet = totalRevenue + totalExpenses;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed] sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">P&L</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Monthly revenue and expenses in USD</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyId} onValueChange={v => setCompanyId(v ?? "all")}>
            <SelectTrigger className="h-9 text-sm w-44 bg-white border-[#e8eaed] rounded-lg">
              <span className="flex-1 text-left text-sm truncate">
                {companyId === "all" ? "All companies" : companies.find(c => c.id === companyId)?.name ?? companyId}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 bg-white border border-[#e8eaed] rounded-lg px-3 h-9">
            <input type="month" value={from} onChange={e => e.target.value && setFrom(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none" />
            <span className="text-[#d1d5db]">—</span>
            <input type="month" value={to} onChange={e => e.target.value && setTo(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-white border-b border-[#e8eaed] z-10">
              <tr>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider min-w-[220px] w-[220px]">Category</th>
                {months.map(m => (
                  <th key={m} className="text-right px-3 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider min-w-[100px]">
                    {fmtMonth(m)}
                  </th>
                ))}
                <th className="text-right px-4 py-3 text-[12px] font-semibold text-[#374151] uppercase tracking-wider min-w-[110px] bg-[#f8fafc]">Total</th>
              </tr>
            </thead>
            <tbody>

              {/* Revenue section */}
              <tr className="bg-emerald-50 border-b border-emerald-100">
                <td colSpan={months.length + 2} className="px-6 py-2 text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                  Revenue
                </td>
              </tr>
              {revenue.map(row => (
                <tr key={row.id} className="border-b border-[#f3f4f6] hover:bg-[#f0fdf9] transition-colors">
                  <td className="px-6 py-2.5 text-[13px] text-[#374151] font-medium">{row.name}</td>
                  {months.map(m => (
                    <td key={m} className="px-3 py-2.5 text-right text-[13px]">
                      <Cell value={row.values[m] ?? 0} />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-[13px] bg-[#f8fafc] font-semibold">
                    <Cell value={row.total} />
                  </td>
                </tr>
              ))}
              {/* Revenue subtotal */}
              <tr className="border-b-2 border-emerald-200 bg-emerald-50/50">
                <td className="px-6 py-2.5 text-[13px] font-bold text-emerald-700">Total Revenue</td>
                {months.map(m => (
                  <td key={m} className="px-3 py-2.5 text-right text-[13px] font-bold text-emerald-700">
                    {revenueByMonth[m] ? fmtUsd(revenueByMonth[m]) : "—"}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right text-[13px] font-bold text-emerald-700 bg-[#f8fafc]">
                  {fmtUsd(totalRevenue)}
                </td>
              </tr>

              {/* Expenses section */}
              <tr className="bg-rose-50 border-b border-rose-100">
                <td colSpan={months.length + 2} className="px-6 py-2 text-[11px] font-bold text-rose-600 uppercase tracking-wider">
                  Expenses
                </td>
              </tr>
              {expenses.map(row => (
                <tr key={row.id} className="border-b border-[#f3f4f6] hover:bg-[#fff5f5] transition-colors">
                  <td className="px-6 py-2.5 text-[13px] text-[#374151] font-medium">{row.name}</td>
                  {months.map(m => (
                    <td key={m} className="px-3 py-2.5 text-right text-[13px]">
                      <Cell value={row.values[m] ?? 0} />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-[13px] bg-[#f8fafc] font-semibold">
                    <Cell value={row.total} />
                  </td>
                </tr>
              ))}
              {/* Expenses subtotal */}
              <tr className="border-b-2 border-rose-200 bg-rose-50/50">
                <td className="px-6 py-2.5 text-[13px] font-bold text-rose-600">Total Expenses</td>
                {months.map(m => (
                  <td key={m} className="px-3 py-2.5 text-right text-[13px] font-bold text-rose-600">
                    {expensesByMonth[m] ? fmtUsd(expensesByMonth[m]) : "—"}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right text-[13px] font-bold text-rose-600 bg-[#f8fafc]">
                  {fmtUsd(totalExpenses)}
                </td>
              </tr>

              {/* Net result */}
              <tr className="bg-white border-t-2 border-[#e8eaed]">
                <td className="px-6 py-3 text-[14px] font-bold text-[#1a202c]">Net Result</td>
                {months.map(m => (
                  <td key={m} className={`px-3 py-3 text-right text-[13px] font-bold ${netByMonth[m] >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                    {netByMonth[m] !== 0 ? fmtUsd(netByMonth[m]) : "—"}
                  </td>
                ))}
                <td className={`px-4 py-3 text-right text-[14px] font-bold bg-[#f8fafc] ${totalNet >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                  {fmtUsd(totalNet)}
                </td>
              </tr>

              {/* Uncategorized */}
              {uncategorizedRow && (
                <tr className="border-t-4 border-amber-200 bg-amber-50/40 hover:bg-amber-50 transition-colors">
                  <td className="px-6 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-amber-700">Uncategorized</span>
                      <span className="text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-semibold">
                        {uncategorizedRow.count} transactions
                      </span>
                    </div>
                  </td>
                  {months.map(m => (
                    <td key={m} className="px-3 py-2.5 text-right text-[13px]">
                      {uncategorizedRow.values[m]
                        ? <span className={`tabular-nums font-medium ${uncategorizedRow.values[m] >= 0 ? "text-amber-600" : "text-amber-700"}`}>
                            {fmtUsd(uncategorizedRow.values[m])}
                          </span>
                        : <span className="text-[#d1d5db]">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-[13px] font-bold text-amber-700 bg-amber-50">
                    {fmtUsd(uncategorizedRow.total)}
                  </td>
                </tr>
              )}

              {/* Control sections (Internal Transfers, VAT Control, etc.) */}
              {[
                { label: "Internal Transfers", totalLabel: "Total Internal", rows: internal },
                { label: "VAT Control", totalLabel: "Total VAT", rows: vat },
                { label: "Outside Company", totalLabel: "Total Outside", rows: outside },
                { label: "Costs Passed to Third Parties", totalLabel: "Total Costs Passed", rows: costsPassed },
              ].map(({ label, totalLabel, rows: sectionRows }) => {
                if (sectionRows.length === 0) return null;
                const byMonth = Object.fromEntries(months.map(m => [m, sectionRows.reduce((s, r) => s + (r.values[m] ?? 0), 0)]));
                const total = sectionRows.reduce((s, r) => s + r.total, 0);
                const isBalanced = Math.abs(total) < 1;
                return (
                  <React.Fragment key={label}>
                    <tr className="bg-[#f8fafc] border-t-4 border-[#e8eaed]">
                      <td colSpan={months.length + 2} className="px-6 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-[#6b7280] uppercase tracking-wider">{label}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isBalanced ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {isBalanced ? "balanced ✓" : `off by ${fmtUsd(total)}`}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {sectionRows.map(row => (
                      <tr key={row.id} className="border-b border-[#f3f4f6] hover:bg-[#f8fafc] transition-colors">
                        <td className="px-6 py-2.5 text-[13px] text-[#6b7280] font-medium">{row.name}</td>
                        {months.map(m => (
                          <td key={m} className="px-3 py-2.5 text-right text-[13px]">
                            {row.values[m] ? <span className="tabular-nums text-[#6b7280]">{fmtUsd(row.values[m])}</span> : <span className="text-[#d1d5db]">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right text-[13px] bg-[#f8fafc] font-semibold text-[#6b7280]">
                          {fmtUsd(row.total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-[#e8eaed]">
                      <td className="px-6 py-2.5 text-[13px] font-bold text-[#6b7280]">{totalLabel}</td>
                      {months.map(m => (
                        <td key={m} className="px-3 py-2.5 text-right text-[13px] font-bold text-[#6b7280]">
                          {byMonth[m] ? fmtUsd(byMonth[m]) : "—"}
                        </td>
                      ))}
                      <td className={`px-4 py-2.5 text-right text-[13px] font-bold bg-[#f8fafc] ${isBalanced ? "text-emerald-600" : "text-amber-600"}`}>
                        {fmtUsd(total)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
