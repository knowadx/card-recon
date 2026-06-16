"use client";

import React, { useEffect, useState } from "react";

type Company = { id: string; name: string; color: string };
type AccountMeta = { id: string; name: string; bank: string; companyId: string };
type CoverageData = {
  months: string[];
  companies: Company[];
  accounts: AccountMeta[];
  matrix: Record<string, Record<string, number>>;
  pendingMatrix: Record<string, Record<string, number>>;
  accountMatrix: Record<string, Record<string, number>>;
  accountPendingMatrix: Record<string, Record<string, number>>;
};

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

function formatMonth(key: string) {
  const [year, month] = key.split("-");
  return { short: MONTH_LABELS[month], year };
}

function Dot({ count, pending, isCurrent }: { count: number; pending: number; isCurrent: boolean }) {
  if (count > 0) return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`w-2.5 h-2.5 rounded-full inline-block ${isCurrent ? "bg-[#00b9a5] shadow-sm shadow-[#00b9a5]/40" : "bg-[#00b9a5]"}`} />
      <span className="text-[10px] text-[#9ca3af] tabular-nums leading-none">{count}</span>
      {pending > 0 && (
        <span className="text-[9px] text-amber-400 tabular-nums leading-none">{pending}p</span>
      )}
    </div>
  );
  return <span className="w-2.5 h-2.5 rounded-full bg-[#e8eaed] inline-block" />;
}

function CompanyBar({ count, pending, isCurrent }: { count: number; pending: number; isCurrent: boolean }) {
  const categorized = count - pending;
  const pct = count > 0 ? Math.round((categorized / count) * 100) : 0;
  const color = count === 0 ? "#e8eaed" : pct < 40 ? "#ef4444" : pct < 75 ? "#f59e0b" : "#22c55e";
  return (
    <div className="flex flex-col items-center gap-0.5 w-full px-1">
      <div className={`w-full h-1.5 rounded-full overflow-hidden ${isCurrent ? "bg-[#00b9a5]/10" : "bg-[#e8eaed]"}`}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: count === 0 ? "0%" : `${pct}%`, background: color }}
        />
      </div>
      {count > 0 && (
        <span className="text-[9px] text-[#9ca3af] tabular-nums leading-none">{categorized}/{count}</span>
      )}
    </div>
  );
}

export default function ControlPage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/coverage").then((r) => r.json()).then((d: CoverageData) => {
      setData(d);
      // expand all by default
      const initial: Record<string, boolean> = {};
      d.companies.forEach((c) => { initial[c.id] = true; });
      setExpanded(initial);
    });
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8fafc]">
        <div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed]">
        <h1 className="text-xl font-bold text-[#1a202c]">Update Control</h1>
        <p className="text-[13px] text-[#6b7280] mt-0.5">Data imported by company and account</p>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-auto">
          <table className="w-full border-collapse">
            {/* Month header */}
            <thead>
              <tr className="border-b border-[#f3f4f6]">
                <th className="text-left px-6 py-4 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider sticky left-0 bg-white min-w-[220px] z-10">
                  Company / Account
                </th>
                {data.months.map((m) => {
                  const { short, year } = formatMonth(m);
                  const isCurrent = m === currentKey;
                  return (
                    <th key={m} className={`px-2 py-4 text-center min-w-[56px] ${isCurrent ? "bg-[#f0fdf9]" : ""}`}>
                      <div className={`text-[12px] font-semibold ${isCurrent ? "text-[#00b9a5]" : "text-[#9ca3af]"}`}>{short}</div>
                      <div className="text-[10px] text-[#d1d5db] mt-0.5">{year}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {data.companies.map((company) => {
                const companyAccounts = data.accounts.filter((a) => a.companyId === company.id);
                const isExpanded = expanded[company.id];

                return (
                  <React.Fragment key={company.id}>
                    {/* Company row */}
                    <tr
                      key={company.id}
                      className="border-b border-[#e8eaed] bg-[#fafbfc] cursor-pointer hover:bg-[#f3f4f6] transition-colors"
                      onClick={() => setExpanded((prev) => ({ ...prev, [company.id]: !prev[company.id] }))}
                    >
                      <td className="px-6 py-3.5 sticky left-0 bg-[#fafbfc] z-10">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[#9ca3af] text-[11px] font-mono w-3 shrink-0 select-none">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: company.color }} />
                          <span className="text-[13.5px] font-semibold text-[#374151]">{company.name}</span>
                          <span className="text-[11px] text-[#9ca3af] ml-1">{companyAccounts.length} conta{companyAccounts.length !== 1 ? "s" : ""}</span>
                        </div>
                      </td>
                      {data.months.map((m) => {
                        const count = data.matrix[company.id]?.[m] ?? 0;
                        const isCurrent = m === currentKey;
                        const pending = data.pendingMatrix[company.id]?.[m] ?? 0;
                        return (
                          <td key={m} className={`px-1 py-3.5 text-center ${isCurrent ? "bg-[#f0fdf9]" : ""}`} title={count > 0 ? `${count - pending} categorizadas de ${count}` : "No data"}>
                            <CompanyBar count={count} pending={pending} isCurrent={isCurrent} />
                          </td>
                        );
                      })}
                    </tr>

                    {/* Account rows (collapsible) */}
                    {isExpanded && companyAccounts.map((account, i) => (
                      <tr
                        key={account.id}
                        className={`border-b border-[#f3f4f6] ${i === companyAccounts.length - 1 ? "border-b-[#e8eaed]" : ""} hover:bg-[#fafbfc] transition-colors`}
                      >
                        <td className="sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5 pl-10 pr-6 py-3">
                            <span className="w-1 h-1 rounded-full bg-[#d1d5db] shrink-0" />
                            <span className="text-[13px] text-[#374151] font-medium">{account.name}</span>
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ml-1 ${
                              account.bank === "Mercury" ? "bg-blue-50 text-blue-600" :
                              account.bank === "Wise" ? "bg-[#e6f7f5] text-[#007a6e]" :
                              account.bank === "Revolut" ? "bg-purple-50 text-purple-600" :
                              "bg-[#f3f4f6] text-[#6b7280]"
                            }`}>{account.bank}</span>
                          </div>
                        </td>
                        {data.months.map((m) => {
                          const count = data.accountMatrix[account.id]?.[m] ?? 0;
                          const isCurrent = m === currentKey;
                          return (
                            <td key={m} className={`px-2 py-3 text-center ${isCurrent ? "bg-[#f0fdf9]" : ""}`} title={count > 0 ? `${count} transactions${(data.accountPendingMatrix[account.id]?.[m] ?? 0) > 0 ? ` · ${data.accountPendingMatrix[account.id][m]} pending` : ""}` : "No data"}>
                              <Dot count={count} pending={data.accountPendingMatrix[account.id]?.[m] ?? 0} isCurrent={isCurrent} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-6 mt-4 px-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00b9a5]" />
            <span className="text-[12px] text-[#6b7280]">Com dados importados</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e8eaed]" />
            <span className="text-[12px] text-[#6b7280]">No data</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-amber-400 font-medium">3p</span>
            <span className="text-[12px] text-[#6b7280]">Uncategorized pending</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-4 rounded bg-[#f0fdf9] border border-[#00b9a5]/20" />
            <span className="text-[12px] text-[#6b7280]">Current month</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#9ca3af]">▸ / ▾</span>
            <span className="text-[12px] text-[#6b7280]">Clique na empresa para expandir/recolher</span>
          </div>
        </div>
      </div>
    </div>
  );
}
