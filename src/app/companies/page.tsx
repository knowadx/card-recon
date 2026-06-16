"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

type Company = { id: string; name: string; cnpj: string | null; color: string };
const EMPTY = { name: "", cnpj: "", color: "#00b9a5" };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => fetch("/api/companies").then((r) => r.json()).then(setCompanies);
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (editing) {
      await fetch(`/api/companies/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    } else {
      await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    }
    setOpen(false); setEditing(null); setForm(EMPTY); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete company?")) return;
    await fetch(`/api/companies/${id}`, { method: "DELETE" }); load();
  };

  const openEdit = (c: Company) => {
    setEditing(c); setForm({ name: c.name, cnpj: c.cnpj || "", color: c.color }); setOpen(true);
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Companies</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">{companies.length} empresa{companies.length !== 1 ? "s" : ""} cadastrada{companies.length !== 1 ? "s" : ""}</p>
        </div>
        <Button
          className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />New company
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {companies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-16 text-center">
            <p className="text-[#9ca3af] text-sm">No companies found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                  <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Empresa</th>
                  <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">CNPJ / EIN</th>
                  <th className="px-5 py-3.5 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f4f6]">
                {companies.map((c) => (
                  <tr key={c.id} className="hover:bg-[#fafbfc] transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="text-[14px] font-medium text-[#1a202c]">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[13px] font-mono text-[#6b7280]">{c.cnpj || "—"}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => del(c.id)}
                          className="p-2 rounded-lg hover:bg-rose-50 text-[#9ca3af] hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(EMPTY); } }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editing ? "Edit company" : "New company"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Legal name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">CNPJ / EIN</Label>
              <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" className="h-10 text-sm rounded-lg border-[#e8eaed] font-mono" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Identification color</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-[#e8eaed]" />
                <span className="text-[13px] text-[#6b7280] font-mono">{form.color}</span>
              </div>
            </div>
            <Button onClick={save} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
