"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Check } from "lucide-react";
import { formatValue, unitPrefix, UNITS } from "@/lib/chartFormat";
import type { Unit, Format } from "@/lib/chartFormat";

type TargetValue = { month: string; value: number | null };
type ChartLink = { chart: { id: string; name: string } };
type Target = { id: string; name: string; color: string; seriesType: string; unit: string; format: string; chartLinks: ChartLink[]; values: TargetValue[]; formulaOp?: string | null; formulaSeriesAId?: string | null; formulaSeriesBId?: string | null; formulaChartAId?: string | null; formulaChartBId?: string | null; formulaALabel?: string; formulaBLabel?: string; };

// Cell that shows formatted value when blurred, raw number when focused
function PlanCell({
  value, unit, format, onChange,
}: {
  value: string;
  unit: Unit;
  format: Format;
  onChange: (val: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const prefix = unitPrefix(unit);
  const num = value === "" ? null : parseFloat(value);
  const formatted = num !== null && !isNaN(num)
    ? prefix + formatValue(num, unit, format)
    : "";

  return (
    <div className="relative w-full">
      {!focused && (
        <div
          className="w-full h-8 flex items-center justify-center text-[13px] tabular-nums text-[#374151] cursor-text rounded-lg border border-transparent hover:border-[#e8eaed] transition-all select-none"
          onClick={() => setFocused(true)}
        >
          {formatted || <span className="text-[#d1d5db]">—</span>}
        </div>
      )}
      {focused && (
        <input
          autoFocus
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setFocused(false)}
          placeholder="—"
          className="w-full h-8 text-center text-[13px] border border-[#00b9a5] rounded-lg bg-white outline-none ring-2 ring-[#00b9a5]/20 transition-all tabular-nums"
        />
      )}
    </div>
  );
}

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

export default function PlanPage() {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-01`;
  const defaultTo = `${now.getFullYear()}-12`;

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [targets, setTargets] = useState<Target[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({}); // key: `${targetId}:${month}`
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const months = monthsBetween(from, to);

  const load = useCallback(() => {
    fetch(`/api/plan/values?from=${from}&to=${to}`)
      .then(r => r.json())
      .then((data: Target[]) => {
        setTargets(data);
        const initial: Record<string, string> = {};
        for (const t of data) {
          for (const v of t.values) {
            initial[`${t.id}:${v.month}`] = v.value !== null ? String(v.value) : "";
          }
        }
        setCells(initial);
        setDirty(false);
      });
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const handleCell = (targetId: string, month: string, val: string) => {
    setCells(prev => ({ ...prev, [`${targetId}:${month}`]: val }));
    setDirty(true);
    setSaved(false);
  };

  const saveAll = async () => {
    setSaving(true);
    const values = [];
    for (const t of targets) {
      if (t.formulaOp) continue; // derived series — skip
      for (const month of months) {
        const raw = cells[`${t.id}:${month}`];
        const num = raw === "" || raw === undefined ? null : parseFloat(raw);
        values.push({ seriesId: t.id, month, value: isNaN(num as number) ? null : num });
      }
    }
    await fetch("/api/plan/values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    setSaving(false);
    setSaved(true);
    setDirty(false);
  };

  // Group targets by first linked chart (or "Unlinked" if none)
  const byChart = targets.reduce<Record<string, { chartName: string; targets: Target[] }>>((acc, t) => {
    const link = t.chartLinks?.[0];
    const key = link ? link.chart.id : "__none__";
    const name = link ? link.chart.name : "Standalone series";
    if (!acc[key]) acc[key] = { chartName: name, targets: [] };
    acc[key].targets.push(t);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Planning</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Enter monthly target values for each chart series</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-[#e8eaed] rounded-lg px-3 h-9">
            <input
              type="month"
              value={from}
              onChange={e => e.target.value && setFrom(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none"
            />
            <span className="text-[#d1d5db]">—</span>
            <input
              type="month"
              value={to}
              onChange={e => e.target.value && setTo(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none"
            />
          </div>
          <button
            onClick={saveAll}
            disabled={!dirty || saving}
            className={`h-9 px-4 text-sm rounded-lg font-semibold flex items-center gap-2 transition-colors ${
              saved && !dirty
                ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                : dirty
                ? "bg-[#00b9a5] hover:bg-[#00a896] text-white"
                : "bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed"
            }`}
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : saved && !dirty ? <Check className="w-3.5 h-3.5" /> : null}
            {saving ? "Saving..." : saved && !dirty ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#9ca3af]">
            <p className="text-sm">No reference series defined yet.</p>
            <p className="text-[12px] mt-1">Go to Charts and add reference series to your charts first.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-white border-b border-[#e8eaed] z-10">
              <tr>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-64 min-w-[256px]">Series</th>
                {months.map(m => (
                  <th key={m} className="text-center px-2 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider min-w-[90px]">
                    {fmtMonth(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(byChart).map(({ chartName, targets: chartTargets }) => (
                <>
                  {/* Chart group header */}
                  <tr key={`group-${chartName}`}>
                    <td colSpan={months.length + 1} className="px-6 pt-5 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-4 rounded-full bg-[#00b9a5] shrink-0" />
                        <span className="text-[11px] font-bold text-[#374151] uppercase tracking-widest">{chartName}</span>
                      </div>
                    </td>
                  </tr>
                  {chartTargets.map((target) => (
                    <tr key={target.id} className="border-b border-[#f3f4f6] bg-white hover:bg-[#f0fdf9] transition-colors">
                      <td className="px-6 py-2 min-w-[256px]">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: target.color }} />
                          <span className="text-[13px] font-medium text-[#374151]">{target.name}</span>
                          {target.formulaOp ? (
                            <span className="text-[10px] text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded font-semibold tracking-wide">ƒ</span>
                          ) : (
                            <span className="text-[10px] text-[#9ca3af] bg-[#f3f4f6] px-1.5 py-0.5 rounded">
                              {UNITS.find(u => u.value === target.unit)?.label ?? target.unit}
                            </span>
                          )}
                        </div>
                      </td>
                      {months.map(month => {
                        const key = `${target.id}:${month}`;
                        const isDerived = !!target.formulaOp;
                        const derivedVal = isDerived
                          ? target.values.find(v => v.month === month)?.value ?? null
                          : null;
                        const prefix = unitPrefix((target.unit ?? "currency") as Unit);
                        return (
                          <td key={month} className="px-1 py-1 text-center">
                            {isDerived ? (
                              <div className="w-full h-8 flex items-center justify-center text-[13px] tabular-nums text-violet-600 font-medium">
                                {derivedVal !== null && derivedVal !== undefined
                                  ? prefix + formatValue(derivedVal, (target.unit ?? "currency") as Unit, (target.format ?? "auto") as Format)
                                  : <span className="text-[#d1d5db]">—</span>}
                              </div>
                            ) : (
                              <PlanCell
                                value={cells[key] ?? ""}
                                unit={(target.unit ?? "currency") as Unit}
                                format={(target.format ?? "auto") as Format}
                                onChange={val => handleCell(target.id, month, val)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
