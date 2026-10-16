"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Plus, Pencil, Trash2, RotateCw, ExternalLink, Search } from "lucide-react";
import { uploadDocument } from "@/lib/uploadClient";

type Status = "vigente" | "vencendo" | "vencido" | "sem_validade" | "substituido";
type Doc = {
  id: string; filename: string; title: string | null; issuedAt: string | null; expiresAt: string | null;
  status: Status; uploadedAt: string; replacesId: string | null;
  company: { id: string; name: string; color: string }; type: { id: string; name: string };
  uploadedBy: { name: string | null; email: string } | null;
};
type Company = { id: string; name: string; color: string };
type DocType = { id: string; name: string };
type Mode = "novo" | "renovar" | "editar";

const STATUS_LABEL: Record<Status, string> = {
  vigente: "Vigente", vencendo: "Vencendo", vencido: "Vencido", sem_validade: "Sem validade", substituido: "Substituído",
};
// cor = estado (nunca decoração)
const STATUS_CLASS: Record<Status, string> = {
  vigente: "bg-emerald-50 text-emerald-700",
  vencendo: "bg-amber-50 text-amber-700",
  vencido: "bg-rose-50 text-rose-600",
  sem_validade: "bg-[#f3f4f6] text-[#6b7280]",
  substituido: "border border-[#e8eaed] text-[#9ca3af]",
};
const FILTROS: { value: string; label: string }[] = [
  { value: "", label: "Atuais" },
  { value: "alerta", label: "Vencidos + vencendo" },
  { value: "vencido", label: "Vencidos" },
  { value: "vencendo", label: "Vencendo" },
  { value: "vigente", label: "Vigentes" },
  { value: "sem_validade", label: "Sem validade" },
  { value: "historico", label: "Histórico completo" },
];
const EMPTY = { companyId: "", typeId: "", title: "", issuedAt: "", expiresAt: "" };

const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
function diasAte(dia: string, hoje: string) {
  return Math.round((Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10)) - Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10))) / 86_400_000);
}
function prazo(d: Doc, hoje: string) {
  if (!d.expiresAt || (d.status !== "vencendo" && d.status !== "vencido")) return null;
  const n = diasAte(d.expiresAt, hoje);
  if (n === 0) return "vence hoje";
  return n > 0 ? `vence em ${n} dia${n > 1 ? "s" : ""}` : `venceu há ${-n} dia${n < -1 ? "s" : ""}`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hoje, setHoje] = useState("");
  const [warnDays, setWarnDays] = useState<number | null>(null);
  const [alertas, setAlertas] = useState({ vencido: 0, vencendo: 0 });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [types, setTypes] = useState<DocType[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [filtro, setFiltro] = useState({ companyId: "", typeId: "", status: "", q: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("novo");
  const [target, setTarget] = useState<Doc | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filtro.companyId) qs.set("companyId", filtro.companyId);
    if (filtro.typeId) qs.set("typeId", filtro.typeId);
    if (filtro.status === "historico") qs.set("historico", "1");
    else if (filtro.status) qs.set("status", filtro.status);
    if (filtro.q.trim()) qs.set("q", filtro.q.trim());
    try {
      const [lista, alerta] = await Promise.all([
        fetch(`/api/documents?${qs}`).then((r) => (r.ok ? r.json() : Promise.reject(r))),
        fetch("/api/documents?status=alerta").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      ]);
      setDocs(lista.documents); setHoje(lista.today); setWarnDays(lista.warnDays);
      setAlertas({
        vencido: alerta.documents.filter((d: Doc) => d.status === "vencido").length,
        vencendo: alerta.documents.filter((d: Doc) => d.status === "vencendo").length,
      });
      // o selo do menu acompanha na hora (sem esperar trocar de página)
      window.dispatchEvent(new CustomEvent("documentos:alertas", { detail: alerta.documents.length }));
      setLoadError("");
    } catch {
      setLoadError("Não foi possível carregar os documentos.");
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    fetch("/api/companies").then((r) => (r.ok ? r.json() : [])).then(setCompanies).catch(() => {});
    fetch("/api/document-types").then((r) => (r.ok ? r.json() : [])).then(setTypes).catch(() => {});
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((me) => setIsManager(me?.role === "superadmin" || me?.role === "admin")).catch(() => {});
  }, []);

  const abrir = (m: Mode, d: Doc | null) => {
    setMode(m); setTarget(d); setFile(null); setFormError("");
    if (m === "novo") setForm({ ...EMPTY, companyId: filtro.companyId, typeId: filtro.typeId });
    else if (d && m === "renovar") setForm({ companyId: d.company.id, typeId: d.type.id, title: d.title ?? "", issuedAt: "", expiresAt: "" });
    else if (d) setForm({ companyId: d.company.id, typeId: d.type.id, title: d.title ?? "", issuedAt: d.issuedAt ?? "", expiresAt: d.expiresAt ?? "" });
    setOpen(true);
  };

  const salvar = async () => {
    setSaving(true); setFormError("");
    try {
      const meta = { typeId: form.typeId, title: form.title, issuedAt: form.issuedAt || null, expiresAt: form.expiresAt || null };
      if (mode === "editar" && target) {
        const res = await fetch(`/api/documents/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `erro ${res.status}`);
      } else {
        if (!form.companyId) throw new Error("escolha a empresa");
        if (!file) throw new Error("escolha o arquivo");
        await uploadDocument(file, { companyId: form.companyId }, { ...meta, replacesId: mode === "renovar" ? target?.id : undefined });
      }
      setOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const apagar = async (d: Doc) => {
    if (!confirm(`Apagar "${d.title || d.filename}"? O arquivo também é apagado e não volta.`)) return;
    const res = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => null))?.error || `erro ${res.status}`);
    load();
  };

  const nomeDe = <T extends { id: string; name: string }>(lista: T[], id: string, vazio: string) => lista.find((x) => x.id === id)?.name ?? vazio;
  const th = "text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider";

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Documentos</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">
            Contrato social, certidões, IR e outros papéis das empresas{warnDays !== null ? ` · aviso ${warnDays} dias antes do vencimento` : ""}
          </p>
        </div>
        <Button className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold" onClick={() => abrir("novo", null)}>
          <Plus className="w-4 h-4 mr-2" />Novo documento
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-5">
        {(alertas.vencido > 0 || alertas.vencendo > 0) && (
          <div className="flex flex-wrap gap-3">
            {alertas.vencido > 0 && (
              <button onClick={() => setFiltro({ ...filtro, status: "vencido" })} className="px-4 py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[13px] font-semibold">
                {alertas.vencido} vencido{alertas.vencido > 1 ? "s" : ""}
              </button>
            )}
            {alertas.vencendo > 0 && (
              <button onClick={() => setFiltro({ ...filtro, status: "vencendo" })} className="px-4 py-2.5 rounded-xl bg-amber-50 text-amber-700 text-[13px] font-semibold">
                {alertas.vencendo} vencendo nos próximos {warnDays} dias
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Select value={filtro.companyId} onValueChange={(v) => setFiltro({ ...filtro, companyId: v ?? "" })}>
            <SelectTrigger className="h-9 w-56 text-sm rounded-lg border-[#e8eaed] bg-white">
              <span className="flex-1 text-left truncate text-sm">{nomeDe(companies, filtro.companyId, "Todas as empresas")}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas as empresas</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtro.typeId} onValueChange={(v) => setFiltro({ ...filtro, typeId: v ?? "" })}>
            <SelectTrigger className="h-9 w-48 text-sm rounded-lg border-[#e8eaed] bg-white">
              <span className="flex-1 text-left truncate text-sm">{nomeDe(types, filtro.typeId, "Todos os tipos")}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos os tipos</SelectItem>
              {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtro.status} onValueChange={(v) => setFiltro({ ...filtro, status: v ?? "" })}>
            <SelectTrigger className="h-9 w-52 text-sm rounded-lg border-[#e8eaed] bg-white">
              <span className="flex-1 text-left truncate text-sm">{FILTROS.find((f) => f.value === filtro.status)?.label}</span>
            </SelectTrigger>
            <SelectContent>{FILTROS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <Input value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} placeholder="Buscar título ou arquivo" className="h-9 w-64 pl-8 text-sm rounded-lg border-[#e8eaed] bg-white" />
          </div>
        </div>

        {loadError ? (
          <div className="bg-white rounded-2xl border border-rose-200 p-10 text-center text-sm text-rose-600">{loadError}</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" /></div>
        ) : docs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-16 text-center">
            <p className="text-[#9ca3af] text-sm">Nenhum documento {filtro.status || filtro.companyId || filtro.typeId || filtro.q ? "com esses filtros" : "ainda — clique em “Novo documento”"}.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                  <th className={th}>Empresa</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Documento</th>
                  <th className={th}>Emissão</th>
                  <th className={th}>Vencimento</th>
                  <th className={th}>Situação</th>
                  <th className="px-5 py-3.5 w-36"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f4f6]">
                {docs.map((d) => (
                  <tr key={d.id} className={`hover:bg-[#fafbfc] transition-colors group ${d.status === "substituido" ? "opacity-60" : ""}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.company.color }} />
                        <span className="text-[13.5px] font-medium text-[#1a202c]">{d.company.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-[#374151]">{d.type.name}</td>
                    <td className="px-5 py-4">
                      <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-[13.5px] text-[#1a202c] hover:text-[#00b9a5] inline-flex items-center gap-1.5">
                        {d.title || d.filename}<ExternalLink className="w-3 h-3 text-[#9ca3af]" />
                      </a>
                      {d.title && <p className="text-[12px] text-[#9ca3af] mt-0.5">{d.filename}</p>}
                    </td>
                    <td className="px-5 py-4 text-[13px] tabular-nums text-[#6b7280]">{br(d.issuedAt)}</td>
                    <td className="px-5 py-4 text-[13px] tabular-nums text-[#374151]">
                      {br(d.expiresAt)}
                      {hoje && prazo(d, hoje) && <p className="text-[12px] text-[#9ca3af] mt-0.5">{prazo(d, hoje)}</p>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${STATUS_CLASS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {d.status !== "substituido" && (
                          <button title="Renovar (sobe a versão nova; esta vai pro histórico)" onClick={() => abrir("renovar", d)} className="p-2 rounded-lg hover:bg-[#e6f7f5] text-[#9ca3af] hover:text-[#00b9a5] transition-colors">
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button title="Editar dados" onClick={() => abrir("editar", d)} className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isManager && (
                          <button title="Apagar" onClick={() => apagar(d)} className="p-2 rounded-lg hover:bg-rose-50 text-[#9ca3af] hover:text-rose-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v); }}>
        <DialogContent className="rounded-2xl max-w-md border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">
              {mode === "novo" ? "Novo documento" : mode === "renovar" ? "Renovar documento" : "Editar documento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {mode === "renovar" && target && (
              <p className="text-[13px] text-[#6b7280] bg-[#f8fafc] rounded-lg px-3 py-2">
                A versão atual ({target.title || target.filename}{target.expiresAt ? `, vence ${br(target.expiresAt)}` : ""}) vai para o histórico.
              </p>
            )}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Empresa</Label>
              <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v ?? "" })} disabled={mode !== "novo"}>
                <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                  <span className="flex-1 text-left truncate text-sm">{form.companyId ? nomeDe(companies, form.companyId, "") : <span className="text-[#9ca3af]">Escolha</span>}</span>
                </SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Tipo</Label>
              <Select value={form.typeId} onValueChange={(v) => setForm({ ...form, typeId: v ?? "" })}>
                <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                  <span className="flex-1 text-left truncate text-sm">{form.typeId ? nomeDe(types, form.typeId, "") : <span className="text-[#9ca3af]">Escolha</span>}</span>
                </SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Título <span className="text-[#9ca3af] font-normal">(opcional)</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: CND federal" className="h-10 text-sm rounded-lg border-[#e8eaed]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Emissão</Label>
                <Input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Vencimento</Label>
                <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
            </div>
            <p className="text-[12px] text-[#9ca3af] -mt-2">Sem vencimento = documento sem validade (ex.: contrato social).</p>
            {mode !== "editar" && (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Arquivo <span className="text-[#9ca3af] font-normal">(PDF ou imagem, até 25 MB)</span></Label>
                <Input type="file" accept=".pdf,image/jpeg,image/png,image/webp,.csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
            )}
            {formError && <p className="text-[13px] text-rose-600">{formError}</p>}
            <Button onClick={salvar} disabled={saving} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
              {saving ? "Enviando…" : mode === "editar" ? "Salvar" : "Enviar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
