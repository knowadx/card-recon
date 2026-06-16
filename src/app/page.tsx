"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Wallet, BarChart2 } from "lucide-react";
import { formatValue, unitPrefix } from "@/lib/chartFormat";
import type { Unit, Format } from "@/lib/chartFormat";
import Link from "next/link";

type Company = { id: string; name: string; color: string };
type DashboardData = {
  managerialByMonth: Record<string, Record<string, number>>;
  byAccount: Record<string, { name: string; currency: string; company: string; inflow: number; outflow: number }>;
  year: number;
};
type ChartSeries = { month: string; value: number };
type TargetSeries = { id: string; name: string; color: string; seriesType: string; unit: string; format: string; yAxis: string; series: { month: string; value: number | null }[] };
type ChartDef = { id: string; name: string; color: string; unit: string; format: string; series: ChartSeries[]; targets: TargetSeries[] };
type ChartsData = { charts: ChartDef[]; months: string[] };

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toFixed(0);
}

function MetricCard({ label, value, icon: Icon, accent }: {
  label: string; value: string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8eaed] p-5">
      <div className="flex items-start justify-between mb-4">
        <p className="text-[13px] text-[#6b7280] font-medium">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-[#1a202c] tabular-nums">{value}</p>
    </div>
  );
}

import { ComposedChart, Bar as ReBar, Line as ReLine } from "recharts";

function ChartCard({ chart }: { chart: ChartDef }) {
  const unit = (chart.unit ?? "currency") as Unit;
  const format = (chart.format ?? "auto") as Format;
  const prefix = unitPrefix(unit);
  const fmtChart = (n: number) => prefix + formatValue(n, unit, format);

  // Merge real series + target series into one data array per month
  const data = chart.series.map(s => {
    const monthIdx = parseInt(s.month.slice(5, 7)) - 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      monthLabel: MONTHS_SHORT[monthIdx],
      value: s.value,
    };
    for (const t of (chart.targets ?? [])) {
      const tv = t.series.find(v => v.month === s.month);
      row[`target_${t.id}`] = tv?.value ?? null;
    }
    return row;
  });

  const hasNegative = data.some(d => (d.value as number) < 0);
  const hasTargets = (chart.targets ?? []).length > 0;
  const hasMainSeries = data.some(d => (d.value as number) !== 0);
  const hasRightAxis = (chart.targets ?? []).some(t => t.yAxis === "right");

  return (
    <div className="bg-white rounded-2xl border border-[#e8eaed] p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: chart.color }} />
        <h3 className="text-[14px] font-semibold text-[#1a202c]">{chart.name}</h3>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} barSize={20}>
          <CartesianGrid strokeDasharray="3 0" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={fmtChart} width={48} />
          {hasRightAxis && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={48} />}
          <Tooltip
            contentStyle={{ fontSize: 12, border: "1px solid #e8eaed", borderRadius: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
            formatter={(v, name) => {
              if (name === "value") return hasMainSeries ? [fmtChart(v as number), chart.name] : ["", ""];
              const t = (chart.targets ?? []).find(t => `target_${t.id}` === name);
              const tUnit = (t?.unit ?? unit) as Unit;
              const tFormat = (t?.format ?? format) as Format;
              return [unitPrefix(tUnit) + formatValue(v as number, tUnit, tFormat), t?.name ?? name];
            }}
          />
          {hasNegative && <ReferenceLine yAxisId="left" y={0} stroke="#e8eaed" />}
          {hasMainSeries && <ReBar yAxisId="left" dataKey="value" fill={chart.color} radius={[4, 4, 0, 0]} />}
          {(chart.targets ?? []).map(t =>
            t.seriesType === "bar" ? (
              <ReBar key={t.id} yAxisId={t.yAxis ?? "left"} dataKey={`target_${t.id}`} fill={t.color} radius={[4, 4, 0, 0]} opacity={0.5} />
            ) : (
              <ReLine key={t.id} yAxisId={t.yAxis ?? "left"} dataKey={`target_${t.id}`} stroke={t.color} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />
            )
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {hasTargets && (
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-3 pl-12">
          {(chart.targets ?? []).map(t => (
            <div key={t.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
              <span className="text-[11px] text-[#9ca3af]">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const defaultFrom = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0")}`;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("all");
  const [fromMonth, setFromMonth] = useState(defaultFrom);
  const [toMonth, setToMonth] = useState(thisMonth);
  const [showUsd, setShowUsd] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [chartsData, setChartsData] = useState<ChartsData | null>(null);

  useEffect(() => { fetch("/api/companies").then(r => r.json()).then(setCompanies); }, []);

  useEffect(() => {
    const year = new Date(toMonth).getFullYear();
    const params = new URLSearchParams({ year: String(year), from: fromMonth, to: toMonth });
    if (companyId !== "all") params.set("companyId", companyId);
    if (showUsd) params.set("usd", "true");
    fetch(`/api/dashboard?${params}`).then(r => r.json()).then(setData);
    fetch(`/api/charts/data?${params}`).then(r => r.json()).then(setChartsData);
  }, [companyId, fromMonth, toMonth, showUsd]);

  const totalIn = data ? Object.values(data.byAccount).reduce((s, a) => s + a.inflow, 0) : 0;
  const totalOut = data ? Object.values(data.byAccount).reduce((s, a) => s + a.outflow, 0) : 0;
  const result = totalIn - totalOut;

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed] sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Dashboard</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Consolidated financial overview</p>
        </div>
        <div className="flex items-center gap-2">
          {/* USD toggle */}
          <button
            onClick={() => setShowUsd(v => !v)}
            className={`h-9 px-3 text-sm rounded-lg font-semibold border transition-colors ${
              showUsd
                ? "bg-[#00b9a5] text-white border-[#00b9a5]"
                : "bg-white text-[#6b7280] border-[#e8eaed] hover:bg-[#f9fafb]"
            }`}
          >
            $ USD
          </button>
          <Select value={companyId} onValueChange={v => setCompanyId(v ?? "all")}>
            <SelectTrigger className="h-9 text-sm w-44 bg-white border-[#e8eaed] rounded-lg">
              <span className="flex-1 text-left text-sm truncate">
                {companyId === "all" ? "Consolidado" : companies.find(c => c.id === companyId)?.name ?? companyId}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Consolidado</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            {[
              { label: "This month", from: () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; }, to: () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; } },
              { label: "Last month", from: () => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth()-1, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }, to: () => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth()-1, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; } },
              { label: "This year", from: () => `${new Date().getFullYear()}-01`, to: () => `${new Date().getFullYear()}-12` },
            ].map(({ label, from, to }) => {
              const isActive = fromMonth === from() && toMonth === to();
              return (
                <button
                  key={label}
                  onClick={() => { setFromMonth(from()); setToMonth(to()); }}
                  className={`h-9 px-3 text-[13px] rounded-lg border font-medium transition-colors whitespace-nowrap ${isActive ? "border-[#00b9a5] bg-[#e6f7f5] text-[#00b9a5]" : "border-[#e8eaed] bg-white text-[#6b7280] hover:bg-[#f9fafb]"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-[#e8eaed] rounded-lg px-3 h-9">
            <input
              type="month"
              value={fromMonth}
              onChange={e => e.target.value && setFromMonth(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none"
            />
            <span className="text-[#d1d5db]">—</span>
            <input
              type="month"
              value={toMonth}
              onChange={e => e.target.value && setToMonth(e.target.value)}
              className="text-sm text-[#374151] bg-transparent focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label={`Total in${showUsd ? " (USD)" : ""}`} value={`${showUsd ? "$" : ""}${fmt(totalIn)}`} icon={TrendingUp} accent="bg-emerald-50 text-emerald-600" />
          <MetricCard label={`Total out${showUsd ? " (USD)" : ""}`} value={`${showUsd ? "$" : ""}${fmt(totalOut)}`} icon={TrendingDown} accent="bg-rose-50 text-rose-500" />
          <MetricCard label={`Result${showUsd ? " (USD)" : ""}`} value={`${showUsd ? "$" : ""}${fmt(result)}`} icon={result >= 0 ? TrendingUp : TrendingDown} accent={result >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"} />
          <MetricCard label="Active accounts" value={String(data ? Object.keys(data.byAccount).length : 0)} icon={Wallet} accent="bg-[#e6f7f5] text-[#00b9a5]" />
        </div>

        {/* Configured charts */}
        {chartsData && chartsData.charts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#1a202c]">Management charts</h2>
              <Link href="/charts" className="text-[12px] text-[#00b9a5] hover:text-[#00a896] font-medium transition-colors">
                Configure charts →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {chartsData.charts.map(chart => <ChartCard key={chart.id} chart={chart} />)}
            </div>
          </div>
        )}

        {/* Empty state for charts */}
        {chartsData && chartsData.charts.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-12 text-center">
            <BarChart2 className="w-8 h-8 text-[#d1d5db] mx-auto mb-3" />
            <p className="text-sm text-[#9ca3af] mb-3">No charts configured yet.</p>
            <Link href="/charts" className="text-[13px] text-[#00b9a5] font-medium hover:underline">
              Configure charts →
            </Link>
          </div>
        )}


        {!data && (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
