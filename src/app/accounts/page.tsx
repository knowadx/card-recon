"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { cnpjValido } from "@/lib/cnpj";

type Company = { id: string; name: string; color: string; cnpj?: string | null };
type Account = { id: string; name: string; bank: string; currency: string; company: Company; syncConfig?: string | null };
type ApiStatus = { ok: boolean | null; label: string };

const BANKS = ["Revolut", "Husky", "Wise", "Mercury", "Dolafy", "Payoneer", "BTG", "XP", "Itaú"];
const CURRENCIES = ["USD", "BRL", "EUR", "GBP", "ARS", "CLP", "MXN", "COP"];
const EMPTY = { name: "", bank: "Mercury", currency: "USD", companyId: "", apiToken: "" };

const BANK_COLORS: Record<string, string> = {
  Mercury: "bg-blue-50 text-blue-700",
  Wise: "bg-[#e6f7f5] text-[#007a6e]",
  Revolut: "bg-purple-50 text-purple-700",
  Husky: "bg-orange-50 text-orange-700",
  Dolafy: "bg-yellow-50 text-yellow-700",
  BTG: "bg-sky-50 text-sky-700",
  XP: "bg-zinc-100 text-zinc-800",
  "Itaú": "bg-amber-50 text-amber-800",
  Payoneer: "bg-orange-50 text-orange-800",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);

  const [revolutConnected, setRevolutConnected] = useState<boolean | null>(null);
  // BTG Pactual Empresas (API direta da conta PJ): configurado no servidor? quais empresas conectadas?
  const [btgStatus, setBtgStatus] = useState<{ configurado: boolean; ambiente: string | null; empresas: string[] }>({ configurado: false, ambiente: null, empresas: [] });
  const [revConnectedCompanies, setRevConnectedCompanies] = useState<string[]>([]);
  const [revClientId, setRevClientId] = useState("");

  const [apiStatus, setApiStatus] = useState<Record<string, ApiStatus>>({});
  const [checkingStatus, setCheckingStatus] = useState(false);

  const load = () => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
    fetch("/api/companies").then((r) => r.json()).then(setCompanies);
  };

  const loadStatus = () => {
    setCheckingStatus(true);
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((data) => { setApiStatus(data); setCheckingStatus(false); })
      .catch(() => setCheckingStatus(false));
  };

  useEffect(() => {
    load();
    loadStatus();
    fetch("/api/revolut/status").then(r => r.json()).then(d => { setRevolutConnected(d.connected); setRevConnectedCompanies(d.companies ?? []); });
    fetch("/api/btg/status").then(r => (r.ok ? r.json() : null)).then(d => d && setBtgStatus(d)).catch(() => {});
  }, []);

const save = async () => {
    // apiToken vazio na edição = manter o atual (não envia); na criação vai como está
    const payload = editing && !form.apiToken ? { ...form, apiToken: undefined } : form;
    if (editing) {
      await fetch(`/api/accounts/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setOpen(false); setEditing(null); setForm(EMPTY); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete account?")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" }); load();
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({ name: a.name, bank: a.bank, currency: a.currency, companyId: a.company.id, apiToken: "" });
    setOpen(true);
  };

  const grouped = companies.map((c) => ({
    company: c,
    accounts: accounts.filter((a) => a.company.id === c.id),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Bank Accounts</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">{accounts.length} accounts registered</p>
        </div>
        <div className="flex items-center gap-3">
          {revolutConnected === true && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg font-medium border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Revolut conectado
            </span>
          )}
          <Button
            variant="outline"
            className="h-9 text-sm border-[#e8eaed] bg-white hover:bg-[#f9fafb] rounded-lg font-medium"
            onClick={loadStatus}
            disabled={checkingStatus}
            title="Check API status"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${checkingStatus ? "animate-spin" : ""}`} />
            {checkingStatus ? "Checking..." : "Check APIs"}
          </Button>
<Button
            className="h-9 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold"
            onClick={() => setOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" />New account
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-6">
        <div className="rounded-xl border border-[#e8eaed] bg-white px-4 py-2.5 text-[13px] text-[#4b5563]">
          Aqui ficam o cadastro e a conexão das contas (token, conectar Revolut e BTG). <a href="/control" className="text-[#00a896] hover:underline">Importar e sincronizar ficam no Controle de importação</a> — clique na conta lá.
        </div>
        {accounts.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#e8eaed] p-16 text-center">
            <p className="text-[#9ca3af] text-sm">No accounts registered.</p>
          </div>
        )}
        {grouped.map(({ company, accounts: accs }) => (
          <div key={company.id}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: company.color }} />
              <h2 className="text-[14px] font-semibold text-[#374151]">{company.name}</h2>
              <span className="text-[12px] text-[#9ca3af]">{accs.length} account{accs.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="bg-white rounded-2xl border border-[#e8eaed] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#f3f4f6] bg-[#fafbfc]">
                    <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Account</th>
                    <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">Bank</th>
                    <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-24">Currency</th>
                    <th className="text-left px-5 py-3.5 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-36">API Status</th>
                    <th className="px-5 py-3.5 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f4f6]">
                  {accs.map((a) => (
                    <tr key={a.id} className="hover:bg-[#fafbfc] transition-colors group">
                      <td className="px-5 py-4">
                        <span className="text-[14px] font-medium text-[#1a202c]">{a.name}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex text-[12px] font-medium px-2.5 py-1 rounded-full ${BANK_COLORS[a.bank] ?? "bg-gray-100 text-gray-700"}`}>
                          {a.bank}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[13px] font-mono text-[#6b7280]">{a.currency}</td>
                      <td className="px-5 py-4">
                        {(() => {
                          const s = apiStatus[a.id];
                          if (checkingStatus && !s) return (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9ca3af]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#d1d5db] animate-pulse" />Checking...
                            </span>
                          );
                          if (!s) return (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9ca3af]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#d1d5db]" />—
                            </span>
                          );
                          if (s.ok === null) return (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9ca3af] bg-[#f3f4f6] px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />{s.label}
                            </span>
                          );
                          if (s.ok) return (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{s.label}
                            </span>
                          );
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full font-medium" title={s.label}>
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />{s.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <a
                            href="/control"
                            className="px-2 py-1 rounded-lg hover:bg-[#e6f7f5] text-[12px] text-[#6b7280] hover:text-[#00a896] transition-colors"
                            title="Importar e sincronizar agora ficam no Controle de importação (clique na conta lá)"
                          >
                            Importar no Controle
                          </a>
                          <button
                            onClick={() => openEdit(a)}
                            className="p-2 rounded-lg hover:bg-[#f3f4f6] text-[#9ca3af] hover:text-[#374151] transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => del(a.id)}
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
          </div>
        ))}
      </div>

      {/* Edit/create dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(EMPTY); } }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">{editing ? "Edit account" : "New account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Mercury USD Principal" className="h-10 text-sm rounded-lg border-[#e8eaed]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Empresa</Label>
              <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v ?? "" })}>
                <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                  <span className="flex-1 text-left truncate text-sm">
                    {companies.find(c => c.id === form.companyId)?.name ?? <span className="text-[#9ca3af]">Select</span>}
                  </span>
                </SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Banco</Label>
                <Select value={form.bank} onValueChange={(v) => setForm({ ...form, bank: v ?? form.bank })}>
                  <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]"><SelectValue /></SelectTrigger>
                  <SelectContent>{BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v ?? form.currency })}>
                  <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {(form.bank === "Mercury" || form.bank === "Wise") && (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">
                  Token da API ({form.bank}) — 1 token por conta
                </Label>
                <Input
                  type="password"
                  value={form.apiToken}
                  onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
                  placeholder={editing ? "deixe vazio p/ manter o atual" : "cole o token desta conta"}
                  className="h-10 text-sm rounded-lg border-[#e8eaed]"
                />
              </div>
            )}
            {form.bank === "Revolut" && (() => {
              const companyName = companies.find(c => c.id === form.companyId)?.name ?? "";
              const connected = !!form.companyId && revConnectedCompanies.includes(form.companyId); // conexão Revolut é por ID da empresa
              return (
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium text-[#374151]">Revolut Business (OAuth por empresa)</Label>
                  {!companyName ? (
                    <p className="text-[12px] text-[#9ca3af]">Escolha a empresa primeiro.</p>
                  ) : connected ? (
                    <p className="text-[12px] text-emerald-700">✓ Revolut conectado para {companyName}</p>
                  ) : (
                    <div className="flex gap-1">
                      <Input
                        value={revClientId}
                        onChange={(e) => setRevClientId(e.target.value)}
                        placeholder="Client ID do app Revolut desta empresa"
                        className="h-10 text-sm rounded-lg border-[#e8eaed] flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!revClientId}
                        className="h-10 text-sm rounded-lg border-purple-200 bg-purple-50 text-purple-700"
                        onClick={() => window.open(`/api/revolut/auth?companyId=${encodeURIComponent(form.companyId)}&client_id=${encodeURIComponent(revClientId)}`, "_blank", "width=700,height=700")}
                      >
                        Conectar
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-[#9ca3af]">Sobe o certificado X.509 no Revolut da empresa, pega o Client ID e conecta. 1 conexão cobre todas as contas daquela org.</p>
                </div>
              );
            })()}
            {form.bank === "BTG" && (() => {
              const empresa = companies.find(c => c.id === form.companyId);
              const cnpjOk = cnpjValido(empresa?.cnpj);
              const conectada = !!empresa && btgStatus.empresas.includes(empresa.id);
              return (
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium text-[#374151]">BTG Pactual Empresas (autorização por CNPJ){btgStatus.ambiente === "sandbox" ? " · testes" : ""}</Label>
                  {!btgStatus.configurado ? (
                    <p className="text-[12px] text-amber-700">BTG ainda não configurado no servidor (falta o Client ID/Secret do app do BTG).</p>
                  ) : !empresa ? (
                    <p className="text-[12px] text-[#9ca3af]">Escolha a empresa primeiro.</p>
                  ) : !cnpjOk ? (
                    <p className="text-[12px] text-amber-700">{empresa.cnpj ? `O CNPJ de ${empresa.name} (${empresa.cnpj}) é inválido — corrija na aba Companies.` : `Cadastre o CNPJ de ${empresa.name} (aba Companies) antes de conectar.`}</p>
                  ) : conectada ? (
                    <p className="text-[12px] text-emerald-700">✓ BTG conectado para {empresa.name}</p>
                  ) : (
                    <Button type="button" variant="outline" className="h-10 text-sm rounded-lg border-sky-200 bg-sky-50 text-sky-700"
                      onClick={() => window.open(`/api/btg/auth?companyId=${encodeURIComponent(empresa.id)}`, "_blank", "width=700,height=760")}>
                      Conectar BTG de {empresa.name}
                    </Button>
                  )}
                  <p className="text-[11px] text-[#9ca3af]">Abre o login do BTG; você escolhe o CNPJ e autoriza a leitura de saldo e extrato.</p>
                </div>
              );
            })()}
            <Button onClick={save} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
