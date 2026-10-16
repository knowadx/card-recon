"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

type DocType = { id: string; name: string; documents: number };

async function erroDe(res: Response) {
  return (await res.json().catch(() => null))?.error || `erro ${res.status}`;
}

export default function DocumentTypesPage() {
  const [types, setTypes] = useState<DocType[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [dias, setDias] = useState("");
  const [diasSalvos, setDiasSalvos] = useState("");
  const [diasMsg, setDiasMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocType | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");

  const load = () => fetch("/api/document-types").then((r) => (r.ok ? r.json() : [])).then(setTypes);
  useEffect(() => {
    load();
    fetch("/api/documents/settings").then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (s) { setDias(String(s.expiryWarningDays)); setDiasSalvos(String(s.expiryWarningDays)); }
    });
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((me) => setIsManager(me?.role === "superadmin" || me?.role === "admin")).catch(() => {});
  }, []);

  const salvarDias = async () => {
    setDiasMsg("");
    const res = await fetch("/api/documents/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiryWarningDays: Number(dias) }) });
    if (!res.ok) return setDiasMsg(await erroDe(res));
    setDiasSalvos(dias); setDiasMsg("salvo");
  };

  const abrir = (t: DocType | null) => { setEditing(t); setName(t?.name ?? ""); setFormError(""); setOpen(true); };
  const salvar = async () => {
    const res = editing
      ? await fetch(`/api/document-types/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
      : await fetch("/api/document-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return setFormError(await erroDe(res));
    setOpen(false); load();
  };
  const apagar = async (t: DocType) => {
    if (!confirm(`Apagar o tipo "${t.name}"?`)) return;
    const res = await fetch(`/api/document-types/${t.id}`, { method: "DELETE" });
    if (!res.ok) alert(await erroDe(res));
    load();
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Tipos de documento</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">
            {isManager ? "A lista usada para classificar e filtrar os documentos das empresas." : "Só administradores alteram esta lista."}
          </p>
        </div>
        {isManager && (
          <Button className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold" onClick={() => abrir(null)}>
            <Plus className="w-4 h-4 mr-2" />Novo tipo
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-6">
        <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 flex flex-wrap items-center gap-3">
          <span className="text-[14px] font-medium text-[#1a202c]">Avisar sobre vencimento</span>
          <Input type="number" min={0} max={365} value={dias} disabled={!isManager} onChange={(e) => { setDias(e.target.value); setDiasMsg(""); }} className="h-9 w-20 text-sm rounded-lg border-[#e8eaed] tabular-nums" />
          <span className="text-[14px] text-[#6b7280]">dias antes</span>
          {isManager && dias !== diasSalvos && (
            <Button onClick={salvarDias} className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Salvar</Button>
          )}
          {diasMsg && <span className={`text-[13px] ${diasMsg === "salvo" ? "text-emerald-600" : "text-rose-600"}`}>{diasMsg}</span>}
        </div>

        <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Tipo</th>
                <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Documentos</th>
                <th className="px-5 py-3.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f4f6]">
              {types.map((t) => (
                <tr key={t.id} className="hover:bg-[#fafbfc] transition-colors group">
                  <td className="px-5 py-4 text-[14px] font-medium text-[#1a202c]">{t.name}</td>
                  <td className="px-5 py-4 text-[13px] tabular-nums text-[#6b7280]">{t.documents}</td>
                  <td className="px-5 py-4">
                    {isManager && (
                      <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button title="Renomear" onClick={() => abrir(t)} className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title={t.documents > 0 ? "Em uso: troque o tipo desses documentos antes" : "Apagar"}
                          disabled={t.documents > 0}
                          onClick={() => apagar(t)}
                          className="p-2 rounded-lg hover:bg-rose-50 text-[#9ca3af] hover:text-rose-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#9ca3af]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editing ? "Renomear tipo" : "Novo tipo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Inscrição estadual" className="h-10 text-sm rounded-lg border-[#e8eaed]" />
            </div>
            {formError && <p className="text-[13px] text-rose-600">{formError}</p>}
            <Button onClick={salvar} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
