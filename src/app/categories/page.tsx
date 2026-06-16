"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";

type Category = { id: string; name: string; code: string | null; type: string; color: string; plSection: string | null; parent: Category | null; children: Category[] };
const EMPTY = { name: "", code: "", color: "#00b9a5", parentId: "", type: "MANAGERIAL", plSection: "" };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<"MANAGERIAL" | "ACCOUNTING">("MANAGERIAL");

  const load = () => fetch("/api/categories").then((r) => r.json()).then(setCategories);
  useEffect(() => { load(); }, []);

  const filtered = categories.filter((c) => c.type === activeType);
  const roots = filtered.filter((c) => !c.parent);

  const save = async () => {
    const payload = { ...form, type: activeType, parentId: form.parentId || null, code: form.code || null };
    if (editing) {
      await fetch(`/api/categories/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setOpen(false); setEditing(null); setForm(EMPTY); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete category?")) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" }); load();
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, code: c.code || "", color: c.color, parentId: c.parent?.id || "", type: c.type, plSection: c.plSection ?? "" });
    setOpen(true);
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#1a202c]">Categories</h1>
            <p className="text-[13px] text-[#6b7280] mt-0.5">{roots.length} categories · {filtered.reduce((s, c) => s + c.children.length, 0)} subcategories</p>
          </div>
          <div className="flex items-center bg-[#f3f4f6] rounded-xl p-1 gap-1">
            <button
              onClick={() => setActiveType("MANAGERIAL")}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${activeType === "MANAGERIAL" ? "bg-white text-[#1a202c] shadow-sm" : "text-[#6b7280] hover:text-[#374151]"}`}
            >
              Managerial
            </button>
            <button
              onClick={() => setActiveType("ACCOUNTING")}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${activeType === "ACCOUNTING" ? "bg-white text-[#1a202c] shadow-sm" : "text-[#6b7280] hover:text-[#374151]"}`}
            >
              Accounting
            </button>
          </div>
        </div>
        <Button
          className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />New category
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {roots.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-16 text-center">
            <p className="text-[#9ca3af] text-sm">No categories found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                  <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-32">Code</th>
                  <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-36">Subcategories</th>
                  <th className="px-5 py-3.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {roots.map((c) => (
                  <React.Fragment key={c.id}>
                    <tr className="border-b border-[#f3f4f6] hover:bg-[#fafbfc] transition-colors group">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                          <span className="text-[14px] font-semibold text-[#1a202c]">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[13px] font-mono text-[#6b7280]">{c.code || "—"}</td>
                      <td className="px-5 py-4">
                        {c.children.length > 0
                          ? <span className="text-[12px] text-[#00b9a5] bg-[#e6f7f5] px-2.5 py-1 rounded-full font-medium">{c.children.length} subcategoria{c.children.length !== 1 ? "s" : ""}</span>
                          : <span className="text-[13px] text-[#9ca3af]">—</span>
                        }
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(c)} className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => del(c.id)} className="p-2 rounded-lg hover:bg-rose-50 text-[#9ca3af] hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                    {c.children.map((child) => (
                      <tr key={child.id} className="border-b border-[#f3f4f6] hover:bg-[#fafbfc] transition-colors group bg-[#fdfeff]">
                        <td className="pl-12 pr-5 py-3.5">
                          <div className="flex items-center gap-2.5 text-[#6b7280]">
                            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#d1d5db]" />
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: child.color }} />
                            <span className="text-[13.5px] font-medium">{child.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] font-mono text-[#9ca3af]">{child.code || "—"}</td>
                        <td className="px-5 py-3.5 text-[13px] text-[#9ca3af]">—</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(child)} className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => del(child.id)} className="p-2 rounded-lg hover:bg-rose-50 text-[#9ca3af] hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(EMPTY); } }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editing ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1.1.01" className="h-10 text-sm rounded-lg border-[#e8eaed] font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Color</Label>
                <div className="flex items-center gap-2 h-10">
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-[#e8eaed]" />
                  <span className="text-[12px] text-[#6b7280] font-mono">{form.color}</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">P&L Section</Label>
              <select
                value={form.plSection}
                onChange={e => setForm(f => ({ ...f, plSection: e.target.value }))}
                className="w-full h-10 text-sm rounded-lg border border-[#e8eaed] px-3 bg-white text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#00b9a5]/30"
              >
                <option value="">Revenue / Expenses (default)</option>
                <option value="internal">Internal Transfers</option>
                <option value="vat">VAT Control</option>
                <option value="outside">Outside Company</option>
                <option value="costs-passed">Costs Passed to Third Parties</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Categoria pai (opcional)</Label>
              <Select value={form.parentId || "none"} onValueChange={(v) => setForm({ ...form, parentId: !v || v === "none" ? "" : v })}>
                <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {roots.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
