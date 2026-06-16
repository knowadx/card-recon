"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, X, GripVertical } from "lucide-react";
import { UNITS, FORMATS, type Unit, type Format } from "@/lib/chartFormat";

type Category = { id: string; name: string; type: string };
type ChartLine = { categoryId: string; factor: 1 | -1 };
type PlanSeries = { id: string; name: string; color: string; seriesType: string; unit: string; format: string; formulaOp?: string | null; formulaSeriesAId?: string | null; formulaSeriesBId?: string | null; formulaChartAId?: string | null; formulaChartBId?: string | null; };
type Chart = {
  id: string; name: string; color: string; unit: string; format: string; order: number;
  lines: Array<{ id: string; categoryId: string; factor: number; category: Category }>;
  seriesLinks: Array<{ id: string; seriesId: string; yAxis: string; series: PlanSeries }>;
};

const COLORS = ["#00b9a5","#6366f1","#f59e0b","#ef4444","#22c55e","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316"];

export default function ChartsPage() {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allSeries, setAllSeries] = useState<PlanSeries[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Chart | null>(null);

  // Chart fields
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [unit, setUnit] = useState<Unit>("currency");
  const [format, setFormat] = useState<Format>("auto");
  const [lines, setLines] = useState<ChartLine[]>([{ categoryId: "", factor: 1 }]);
  const [linkedSeries, setLinkedSeries] = useState<Array<{ seriesId: string; yAxis: "left" | "right" }>>([]);

  // Series management dialog
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [seriesName, setSeriesName] = useState("");
  const [seriesColor, setSeriesColor] = useState(COLORS[1]);
  const [seriesType, setSeriesType] = useState<"line" | "bar">("line");
  const [seriesUnit, setSeriesUnit] = useState<Unit>("currency");
  const [seriesFormat, setSeriesFormat] = useState<Format>("auto");
  const [editingSeries, setEditingSeries] = useState<PlanSeries | null>(null);
  const [seriesIsDerived, setSeriesIsDerived] = useState(false);
  const [seriesFormulaOp, setSeriesFormulaOp] = useState<string>("+");
  // operand format: "series:<id>" or "chart:<id>"
  const [seriesFormulaA, setSeriesFormulaA] = useState<string>("");
  const [seriesFormulaB, setSeriesFormulaB] = useState<string>("");

  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);

  const onDragStart = (i: number) => { dragIndex.current = i; };
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === i) return;
    const reordered = [...charts];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(i, 0, moved);
    dragIndex.current = i;
    setCharts(reordered);
  };
  const onDragEnd = async () => {
    dragIndex.current = null;
    await fetch("/api/charts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: charts.map(c => c.id) }),
    });
  };

  const managerial = categories.filter(c => c.type === "MANAGERIAL");

  const load = () => {
    fetch("/api/charts").then(r => r.json()).then(setCharts);
    fetch("/api/categories").then(r => r.json()).then(setCategories);
    fetch("/api/plan/series").then(r => r.json()).then(setAllSeries);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node))
        setOpenColorPicker(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openNew = () => {
    setEditing(null); setName(""); setColor(COLORS[0]); setUnit("currency"); setFormat("auto");
    setLines([]); setLinkedSeries([]);
    setOpen(true);
  };

  const openEdit = (chart: Chart) => {
    setEditing(chart); setName(chart.name); setColor(chart.color);
    setUnit((chart.unit || "currency") as Unit); setFormat((chart.format || "auto") as Format);
    setLines(chart.lines.length > 0 ? chart.lines.map(l => ({ categoryId: l.categoryId, factor: l.factor as 1 | -1 })) : []);
    setLinkedSeries(chart.seriesLinks.map(l => ({ seriesId: l.seriesId, yAxis: (l.yAxis ?? "left") as "left" | "right" })));
    setOpen(true);
  };

  const save = async () => {
    const validLines = lines.filter(l => l.categoryId);
    if (!name.trim()) return;
    const body = { name, color, unit, format, lines: validLines };

    let chartId: string;
    if (editing) {
      const res = await fetch(`/api/charts/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      chartId = (await res.json()).id;
      // Sync series links: delete removed, add new, update yAxis
      const existing = editing.seriesLinks.map(l => l.seriesId);
      const linkedIds = linkedSeries.map(l => l.seriesId);
      for (const sid of existing) {
        if (!linkedIds.includes(sid)) {
          await fetch("/api/charts/series", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chartId, seriesId: sid }) });
        }
      }
      for (const { seriesId: sid, yAxis } of linkedSeries) {
        if (!existing.includes(sid)) {
          await fetch("/api/charts/series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chartId, seriesId: sid }) });
        }
        await fetch("/api/charts/series", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chartId, seriesId: sid, yAxis }) });
      }
    } else {
      const res = await fetch("/api/charts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      chartId = (await res.json()).id;
      for (const { seriesId: sid, yAxis } of linkedSeries) {
        await fetch("/api/charts/series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chartId, seriesId: sid }) });
        if (yAxis === "right") {
          await fetch("/api/charts/series", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chartId, seriesId: sid, yAxis }) });
        }
      }
    }
    setOpen(false);
    load();
  };

  const deleteChart = async (id: string) => {
    if (!confirm("Delete chart?")) return;
    await fetch(`/api/charts/${id}`, { method: "DELETE" });
    load();
  };

  const addLine = () => setLines(prev => [...prev, { categoryId: "", factor: 1 }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, j) => j !== i));
  const updateLine = (i: number, patch: Partial<ChartLine>) =>
    setLines(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l));

  const toggleSeries = (sid: string) =>
    setLinkedSeries(prev => prev.some(l => l.seriesId === sid)
      ? prev.filter(l => l.seriesId !== sid)
      : [...prev, { seriesId: sid, yAxis: "left" }]);

  const toggleSeriesYAxis = (sid: string) =>
    setLinkedSeries(prev => prev.map(l => l.seriesId === sid
      ? { ...l, yAxis: l.yAxis === "left" ? "right" : "left" }
      : l));

  // Series CRUD
  const openNewSeries = () => {
    setEditingSeries(null); setSeriesName(""); setSeriesColor(COLORS[1]);
    setSeriesType("line"); setSeriesUnit("currency"); setSeriesFormat("auto");
    setSeriesIsDerived(false); setSeriesFormulaOp("+"); setSeriesFormulaA(""); setSeriesFormulaB("");
    setSeriesOpen(true);
  };
  const openEditSeries = (s: PlanSeries) => {
    setEditingSeries(s); setSeriesName(s.name); setSeriesColor(s.color);
    setSeriesType(s.seriesType as "line" | "bar"); setSeriesUnit(s.unit as Unit); setSeriesFormat(s.format as Format);
    const isDerived = !!(s.formulaOp && (s.formulaSeriesAId || s.formulaChartAId) && (s.formulaSeriesBId || s.formulaChartBId));
    setSeriesIsDerived(isDerived);
    setSeriesFormulaOp(s.formulaOp || "+");
    setSeriesFormulaA(
      s.formulaChartAId ? `chart:${s.formulaChartAId}` :
      s.formulaSeriesAId ? `series:${s.formulaSeriesAId}` : ""
    );
    setSeriesFormulaB(
      s.formulaChartBId ? `chart:${s.formulaChartBId}` :
      s.formulaSeriesBId ? `series:${s.formulaSeriesBId}` : ""
    );
    setSeriesOpen(true);
  };
  const saveSeries = async () => {
    if (!seriesName.trim()) return;
    const parseOperand = (val: string) => {
      if (!val) return { seriesId: null, chartId: null };
      const [type, id] = val.split(":");
      return type === "chart" ? { seriesId: null, chartId: id } : { seriesId: id, chartId: null };
    };
    const opA = seriesIsDerived ? parseOperand(seriesFormulaA) : { seriesId: null, chartId: null };
    const opB = seriesIsDerived ? parseOperand(seriesFormulaB) : { seriesId: null, chartId: null };
    const body = {
      name: seriesName, color: seriesColor, seriesType, unit: seriesUnit, format: seriesFormat,
      formulaOp: seriesIsDerived ? seriesFormulaOp : null,
      formulaSeriesAId: opA.seriesId,
      formulaSeriesBId: opB.seriesId,
      formulaChartAId: opA.chartId,
      formulaChartBId: opB.chartId,
    };
    if (editingSeries) {
      await fetch(`/api/plan/series/${editingSeries.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/plan/series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setSeriesOpen(false);
    load();
  };
  const deleteSeries = async (id: string) => {
    if (!confirm("Delete this series? Its values will also be deleted.")) return;
    await fetch(`/api/plan/series/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Charts</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Configure dashboard charts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openNewSeries} variant="outline" className="h-9 text-sm rounded-lg border-[#e8eaed] text-[#374151]">
            <Plus className="w-4 h-4 mr-2" />New series
          </Button>
          <Button onClick={openNew} className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
            <Plus className="w-4 h-4 mr-2" />New chart
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-8">
        {/* Charts list */}
        {charts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#9ca3af]">
            <p className="text-sm">No charts configured yet.</p>
            <button onClick={openNew} className="mt-3 text-[#00b9a5] text-sm font-medium hover:underline">Create first chart</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 max-w-2xl">
            {charts.map((chart, i) => (
              <div key={chart.id}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={e => onDragOver(e, i)}
                onDragEnd={onDragEnd}
                className="bg-white rounded-2xl border border-[#e8eaed] p-5 cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.01] transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-[#d1d5db] shrink-0 -ml-1" />
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: chart.color }} />
                    <span className="text-[15px] font-semibold text-[#1a202c]">{chart.name}</span>
                    <span className="text-[11px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-0.5 rounded">{chart.unit}</span>
                    <span className="text-[11px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-0.5 rounded">{chart.format}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(chart)} className="text-[#9ca3af] hover:text-[#374151] transition-colors"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteChart(chart.id)} className="text-[#9ca3af] hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {chart.lines.map((l, i) => (
                    <span key={i} className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full font-medium ${l.factor > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
                      {l.factor > 0 ? "+" : "−"} {l.category.name}
                    </span>
                  ))}
                  {chart.seriesLinks.map(link => (
                    <span key={link.id} className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full font-medium bg-[#f3f4f6] text-[#6b7280]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: link.series.color }} />
                      {link.series.name}
                      {link.yAxis === "right" && <span className="text-[10px] font-bold text-[#9ca3af] bg-white border border-[#e8eaed] rounded px-1">R</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Series library */}
        {allSeries.length > 0 && (
          <div className="max-w-2xl">
            <h2 className="text-[13px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Series library</h2>
            <div className="bg-white rounded-2xl border border-[#e8eaed] divide-y divide-[#f3f4f6]">
              {allSeries.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 text-[13px] font-medium text-[#374151]">{s.name}</span>
                  <span className="text-[11px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-0.5 rounded">{s.seriesType}</span>
                  <span className="text-[11px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-0.5 rounded">{s.unit}</span>
                  <span className="text-[11px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-0.5 rounded">{s.format}</span>
                  {s.formulaOp && (
                    <span className="text-[11px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded font-medium">
                      {(s.formulaChartAId ? charts.find(c => c.id === s.formulaChartAId)?.name : allSeries.find(x => x.id === s.formulaSeriesAId)?.name) ?? "?"}
                      {" "}{s.formulaOp}{" "}
                      {(s.formulaChartBId ? charts.find(c => c.id === s.formulaChartBId)?.name : allSeries.find(x => x.id === s.formulaSeriesBId)?.name) ?? "?"}
                    </span>
                  )}
                  <button onClick={() => openEditSeries(s)} className="text-[#9ca3af] hover:text-[#374151] transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteSeries(s.id)} className="text-[#9ca3af] hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chart edit dialog */}
      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false); }}>
        <DialogContent className="rounded-2xl max-w-lg border-[#e8eaed] shadow-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editing ? "Edit chart" : "New chart"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            {/* Name + Color */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Net Profit" className="h-9 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Color</Label>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full transition-all ${color === c ? "ring-2 ring-offset-1 ring-[#374151] scale-110" : ""}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Unit + Format */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Unit</Label>
                <select value={unit} onChange={e => setUnit(e.target.value as Unit)}
                  className="w-full h-9 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                  {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Format</Label>
                <select value={format} onChange={e => setFormat(e.target.value as Format)}
                  className="w-full h-9 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>

            {/* Category lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium text-[#374151]">Managerial categories</Label>
                <button onClick={addLine} className="text-[12px] text-[#00b9a5] hover:text-[#00a896] font-medium flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" />Add
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-[#d1d5db] shrink-0" />
                    <button onClick={() => updateLine(i, { factor: line.factor === 1 ? -1 : 1 })}
                      className={`w-8 h-8 rounded-lg text-sm font-bold shrink-0 transition-colors ${line.factor === 1 ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-rose-50 text-rose-600 hover:bg-rose-100"}`}>
                      {line.factor === 1 ? "+" : "−"}
                    </button>
                    <select value={line.categoryId} onChange={e => updateLine(i, { categoryId: e.target.value })}
                      className="flex-1 h-8 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                      <option value="">Select category...</option>
                      {managerial.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(i)} className="text-[#9ca3af] hover:text-rose-500 transition-colors shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#9ca3af]">
                <span className="text-emerald-600 font-medium">+</span> adds · <span className="text-rose-500 font-medium">−</span> subtracts
              </p>
            </div>

            {/* Link plan series */}
            {allSeries.length > 0 && (
              <div className="space-y-2 border-t border-[#e8eaed] pt-4">
                <Label className="text-[13px] font-medium text-[#374151]">Reference series <span className="text-[#9ca3af] font-normal">(from Planning)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {allSeries.map(s => {
                    const link = linkedSeries.find(l => l.seriesId === s.id);
                    const linked = !!link;
                    return (
                      <div key={s.id} className="inline-flex items-center rounded-full border overflow-hidden transition-all"
                        style={linked ? { borderColor: s.color } : { borderColor: "#e8eaed" }}>
                        <button onClick={() => toggleSeries(s.id)}
                          className={`inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 font-medium transition-all ${linked ? "text-white" : "text-[#6b7280] hover:bg-[#f3f4f6]"}`}
                          style={linked ? { background: s.color } : {}}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: linked ? "white" : s.color }} />
                          {s.name}
                        </button>
                        {linked && (
                          <button onClick={() => toggleSeriesYAxis(s.id)}
                            className="px-2 py-1.5 text-[11px] font-bold transition-colors"
                            style={{ background: link.yAxis === "right" ? "#1a202c" : s.color, color: "white" }}
                            title="Toggle right axis">
                            {link.yAxis === "right" ? "R" : "L"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[#9ca3af]">Click to toggle. <span className="font-medium">L/R</span> = axis side.</p>
              </div>
            )}

            <Button onClick={save} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
              {editing ? "Save changes" : "Create chart"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Series edit dialog */}
      <Dialog open={seriesOpen} onOpenChange={v => { if (!v) setSeriesOpen(false); }}>
        <DialogContent className="rounded-2xl max-w-md border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editingSeries ? "Edit series" : "New series"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">

            {/* Name + Color */}
            <div className="flex gap-3 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Name</Label>
                <Input value={seriesName} onChange={e => setSeriesName(e.target.value)} placeholder="e.g. Revenue per Head" className="h-9 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Color</Label>
                <div className="relative" ref={openColorPicker === "series" ? colorPickerRef : undefined}>
                  <button onClick={() => setOpenColorPicker(openColorPicker === "series" ? null : "series")}
                    className="w-9 h-9 rounded-lg border border-[#e8eaed] shadow-sm"
                    style={{ background: seriesColor }} />
                  {openColorPicker === "series" && (
                    <div className="absolute right-0 top-11 z-20 flex flex-wrap gap-1.5 bg-white border border-[#e8eaed] rounded-xl p-2.5 shadow-lg w-44">
                      {COLORS.map(c => (
                        <button key={c} onClick={() => { setSeriesColor(c); setOpenColorPicker(null); }}
                          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${seriesColor === c ? "ring-2 ring-offset-1 ring-[#374151]" : ""}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Display / Unit / Format */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Display as</Label>
                <select value={seriesType} onChange={e => setSeriesType(e.target.value as "line" | "bar")}
                  className="w-full h-9 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                  <option value="line">Line</option>
                  <option value="bar">Bar</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Unit</Label>
                <select value={seriesUnit} onChange={e => setSeriesUnit(e.target.value as Unit)}
                  className="w-full h-9 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                  {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-[#374151]">Format</Label>
                <select value={seriesFormat} onChange={e => setSeriesFormat(e.target.value as Format)}
                  className="w-full h-9 text-sm border border-[#e8eaed] rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30">
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>

            {/* Derived / Formula */}
            <div className="border border-[#e8eaed] rounded-xl p-4 space-y-3 bg-[#fafbfc]">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={seriesIsDerived} onChange={e => setSeriesIsDerived(e.target.checked)}
                  className="w-4 h-4 rounded accent-violet-600" />
                <span className="text-[13px] font-semibold text-[#374151]">Derived series</span>
                <span className="text-[11px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full font-semibold">formula</span>
              </label>

              {seriesIsDerived && (
                <div className="space-y-3 pt-1">
                  <p className="text-[12px] text-[#9ca3af]">Calculated automatically — values are never entered manually.</p>

                  {/* A op B — correct order */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">A</span>
                      <select value={seriesFormulaA} onChange={e => setSeriesFormulaA(e.target.value)}
                        className="w-full h-9 text-sm border border-violet-200 rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-violet-300">
                        <option value="">Select…</option>
                        <optgroup label="Charts (actual data)">
                          {charts.map(c => <option key={`chart:${c.id}`} value={`chart:${c.id}`}>{c.name}</option>)}
                        </optgroup>
                        <optgroup label="Planning series">
                          {allSeries.filter(s => !s.formulaOp && (!editingSeries || s.id !== editingSeries.id)).map(s => (
                            <option key={`series:${s.id}`} value={`series:${s.id}`}>{s.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    <div className="space-y-1 flex flex-col items-center">
                      <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">Op</span>
                      <select value={seriesFormulaOp} onChange={e => setSeriesFormulaOp(e.target.value)}
                        className="w-14 h-9 text-center text-[16px] font-bold border border-violet-200 rounded-lg bg-white text-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300">
                        <option value="+">+</option>
                        <option value="-">−</option>
                        <option value="*">×</option>
                        <option value="/">÷</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">B</span>
                      <select value={seriesFormulaB} onChange={e => setSeriesFormulaB(e.target.value)}
                        className="w-full h-9 text-sm border border-violet-200 rounded-lg px-2 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-violet-300">
                        <option value="">Select…</option>
                        <optgroup label="Charts (actual data)">
                          {charts.map(c => <option key={`chart:${c.id}`} value={`chart:${c.id}`}>{c.name}</option>)}
                        </optgroup>
                        <optgroup label="Planning series">
                          {allSeries.filter(s => !s.formulaOp && (!editingSeries || s.id !== editingSeries.id)).map(s => (
                            <option key={`series:${s.id}`} value={`series:${s.id}`}>{s.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button onClick={saveSeries} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
              {editingSeries ? "Save changes" : "Create series"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
