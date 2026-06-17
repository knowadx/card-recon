"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, RefreshCw, Upload } from "lucide-react";

type Company = { id: string; name: string; color: string };
type Account = { id: string; name: string; bank: string; currency: string; company: Company; syncConfig?: string | null; operation?: { id: string; name: string } | null };
type MercuryAccount = { id: string; name: string; availableBalance?: number; kind: string; legalBusinessName?: string; entity: string };
type WiseProfile = { id: string; label: string };
type ApiStatus = { ok: boolean | null; label: string };

const BANKS = ["Revolut", "Husky", "Wise", "Mercury", "Dolafy"];
const CURRENCIES = ["USD", "BRL", "EUR", "GBP", "ARS", "CLP", "MXN", "COP"];
const EMPTY = { name: "", bank: "Mercury", currency: "USD", companyId: "", apiToken: "" };

const defaultSyncFrom = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
};

const BANK_COLORS: Record<string, string> = {
  Mercury: "bg-blue-50 text-blue-700",
  Wise: "bg-[#e6f7f5] text-[#007a6e]",
  Revolut: "bg-purple-50 text-purple-700",
  Husky: "bg-orange-50 text-orange-700",
  Dolafy: "bg-yellow-50 text-yellow-700",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);

  const [mercurySyncOpen, setMercurySyncOpen] = useState(false);
  const [mercurySyncTarget, setMercurySyncTarget] = useState<Account | null>(null);
  const [mercuryAccounts, setMercuryAccounts] = useState<MercuryAccount[]>([]);
  const [mercuryAccountId, setMercuryAccountId] = useState("");
  const [mercurySyncFrom, setMercurySyncFrom] = useState(defaultSyncFrom);
  const [mercurySyncing, setMercurySyncing] = useState(false);
  const [mercurySyncResult, setMercurySyncResult] = useState<{ imported: number; skipped: number } | null>(null);

  const [wiseSyncOpen, setWiseSyncOpen] = useState(false);
  const [wiseSyncTarget, setWiseSyncTarget] = useState<Account | null>(null);
  const [wiseProfiles, setWiseProfiles] = useState<WiseProfile[]>([]);
  const [wiseProfileId, setWiseProfileId] = useState("");
  const [wiseSyncFrom, setWiseSyncFrom] = useState(defaultSyncFrom);
  const [wiseSyncing, setWiseSyncing] = useState(false);
  const [wiseSyncResult, setWiseSyncResult] = useState<{ imported: number; skipped?: number; alreadyExisted?: number; parseFailed?: number; error?: string; warning?: string } | null>(null);

  const [huskyOpen, setHuskyOpen] = useState(false);
  const [huskyTarget, setHuskyTarget] = useState<Account | null>(null);
  const [huskyImporting, setHuskyImporting] = useState(false);
  const [huskyResult, setHuskyResult] = useState<{ imported: number; skipped: number; error?: string } | null>(null);
  const [huskyDebug, setHuskyDebug] = useState<{ headers: unknown[]; sampleRows: unknown[][] } | null>(null);
  const [huskyDebugging, setHuskyDebugging] = useState(false);
  const huskyFileRef = useRef<HTMLInputElement>(null);

  const [dolafyOpen, setDolafyOpen] = useState(false);
  const [dolafyTarget, setDolafyTarget] = useState<Account | null>(null);
  const [dolafyImporting, setDolafyImporting] = useState(false);
  const [dolafyResult, setDolafyResult] = useState<{ imported: number; skipped: number; error?: string } | null>(null);
  const [dolafyFileName, setDolafyFileName] = useState<string | null>(null);
  const dolafyFileRef = useRef<HTMLInputElement>(null);

  const [wiseConnected, setWiseConnected] = useState<boolean | null>(null);
  const [revolutConnected, setRevolutConnected] = useState<boolean | null>(null);
  const [revConnectedCompanies, setRevConnectedCompanies] = useState<string[]>([]);
  const [revClientId, setRevClientId] = useState("");
  const [revolutSyncOpen, setRevolutSyncOpen] = useState(false);
  const [revolutSyncTarget, setRevolutSyncTarget] = useState<Account | null>(null);
  const [revolutAccounts, setRevolutAccounts] = useState<{ id: string; name: string; currency: string; balance: number }[]>([]);
  const [revolutAccountId, setRevolutAccountId] = useState("");
  const [revolutSyncFrom, setRevolutSyncFrom] = useState(defaultSyncFrom);
  const [revolutSyncing, setRevolutSyncing] = useState(false);
  const [revolutSyncResult, setRevolutSyncResult] = useState<{ imported: number; skipped: number; error?: string } | null>(null);

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
    fetch("/api/wise/status").then(r => r.json()).then(d => setWiseConnected(d.connected));
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

  const openMercurySync = async (a: Account) => {
    setMercurySyncTarget(a);
    setMercurySyncResult(null);
    setMercuryAccountId("");
    setMercurySyncOpen(true);
    const list: MercuryAccount[] = await fetch(`/api/sync/mercury/accounts?accountId=${a.id}`).then((r) => r.json());

    // Filter to only accounts belonging to this company, matched by legalBusinessName or entity key
    const companyName = a.company.name.toLowerCase();
    const filtered = list.filter((m) => {
      const lbn = (m.legalBusinessName ?? "").toLowerCase();
      const ent = (m.entity ?? "").toLowerCase();
      return lbn.includes(companyName) || companyName.includes(lbn) ||
             ent.includes(companyName) || companyName.includes(ent);
    });

    // Auto-select if only one option and pre-fill from syncConfig
    const syncConfig = a.syncConfig ? JSON.parse(a.syncConfig) : null;
    if (syncConfig?.mercuryAccountId) setMercuryAccountId(syncConfig.mercuryAccountId);
    else if (filtered.length === 1) setMercuryAccountId(filtered[0].id);

    setMercuryAccounts(filtered.length > 0 ? filtered : list);
  };

  const runMercurySync = async () => {
    if (!mercurySyncTarget || !mercuryAccountId) return;
    setMercurySyncing(true);
    setMercurySyncResult(null);
    const res = await fetch("/api/sync/mercury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mercuryAccountId,
        accountId: mercurySyncTarget.id,
        from: mercurySyncFrom,
        entity: mercuryAccounts.find((m) => m.id === mercuryAccountId)?.entity,
        kind: mercuryAccounts.find((m) => m.id === mercuryAccountId)?.kind === "credit" ? "creditCard" : "account",
      }),
    }).then((r) => r.json());
    setMercurySyncing(false);
    setMercurySyncResult(res);
  };

  const openHuskyImport = (a: Account) => {
    setHuskyTarget(a);
    setHuskyResult(null);
    setHuskyOpen(true);
  };

  const runHuskyDebug = async () => {
    if (!huskyFileRef.current?.files?.[0]) return;
    setHuskyDebugging(true);
    setHuskyDebug(null);
    const fd = new FormData();
    fd.append("file", huskyFileRef.current.files[0]);
    const res = await fetch("/api/transactions/import/husky/debug", { method: "POST", body: fd }).then((r) => r.json());
    setHuskyDebugging(false);
    setHuskyDebug(res);
  };

  const runHuskyImport = async () => {
    if (!huskyTarget || !huskyFileRef.current?.files?.[0]) return;
    setHuskyImporting(true);
    setHuskyResult(null);
    const fd = new FormData();
    fd.append("file", huskyFileRef.current.files[0]);
    fd.append("accountId", huskyTarget.id);
    const res = await fetch("/api/transactions/import/husky", { method: "POST", body: fd }).then((r) => r.json());
    setHuskyImporting(false);
    setHuskyResult(res);
    if (!res.error) load();
  };

  const openRevolutSync = async (a: Account) => {
    setRevolutSyncTarget(a);
    setRevolutSyncResult(null);
    setRevolutAccountId("");
    setRevolutSyncOpen(true);
    const res = await fetch(`/api/revolut/accounts?accountId=${a.id}`).then(r => r.json());
    if (Array.isArray(res)) {
      setRevolutAccounts(res.map((acc: { id: string; name: string; currency: string; balance: number }) => ({
        id: acc.id,
        name: acc.name,
        currency: acc.currency,
        balance: acc.balance,
      })));
    }
  };

  const runRevolutSync = async () => {
    if (!revolutSyncTarget) return;
    setRevolutSyncing(true);
    setRevolutSyncResult(null);
    const res = await fetch("/api/sync/revolut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: revolutSyncTarget.id, revolutAccountId: revolutAccountId || null, from: revolutSyncFrom }),
    }).then(r => r.json());
    setRevolutSyncing(false);
    setRevolutSyncResult(res);
  };

  const openWiseSync = async (a: Account) => {
    setWiseSyncTarget(a);
    setWiseSyncResult(null);
    setWiseSyncOpen(true);

    // Pre-select profile from saved syncConfig
    const savedProfileId = a.syncConfig ? (JSON.parse(a.syncConfig) as { wiseProfileId?: string }).wiseProfileId ?? "" : "";
    setWiseProfileId(savedProfileId);

    const list: WiseProfile[] = await fetch(`/api/sync/wise/accounts?accountId=${a.id}`).then((r) => r.json());
    const profiles = Array.isArray(list) ? list : [];

    const companyName = a.company.name.toLowerCase();
    const accountName = a.name.toLowerCase();
    const matches = (label: string) => {
      const l = label.toLowerCase();
      return l.includes(companyName) || companyName.includes(l) || l.includes(accountName) || accountName.includes(l);
    };

    // Pré-seleciona pelo profile salvo; senão tenta casar pelo nome da conta/empresa
    const match = savedProfileId
      ? profiles.find((p) => p.id === savedProfileId)
      : profiles.find((p) => matches(p.label));

    if (match) {
      setWiseProfileId(match.id);
      // Show only the matched profile — user doesn't need to pick
      setWiseProfiles([match]);
    } else {
      // No match found — show all so user can pick manually
      setWiseProfiles(profiles);
    }
  };

  const runWiseSync = async () => {
    if (!wiseSyncTarget || !wiseProfileId) return;
    setWiseSyncing(true);
    setWiseSyncResult(null);
    const res = await fetch("/api/sync/wise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: wiseProfileId, accountId: wiseSyncTarget.id, from: wiseSyncFrom }),
    }).then((r) => r.json());
    setWiseSyncing(false);
    setWiseSyncResult(res);
    if (!res.error) {
      setTimeout(() => { setWiseSyncOpen(false); setWiseSyncResult(null); }, 2500);
    }
  };

  const runDolafyImport = async () => {
    if (!dolafyTarget || !dolafyFileRef.current?.files?.[0]) return;
    setDolafyImporting(true);
    setDolafyResult(null);
    const fd = new FormData();
    fd.append("file", dolafyFileRef.current.files[0]);
    fd.append("accountId", dolafyTarget.id);
    const res = await fetch("/api/transactions/import/dolafy", { method: "POST", body: fd }).then((r) => r.json());
    setDolafyImporting(false);
    setDolafyResult(res);
    if (!res.error) setTimeout(() => { setDolafyOpen(false); setDolafyResult(null); }, 2500);
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
                          {a.bank === "Husky" && (
                            <button
                              onClick={() => openHuskyImport(a)}
                              className="p-2 rounded-lg hover:bg-orange-50 text-[#9ca3af] hover:text-orange-500 transition-colors"
                              title="Import Husky statement (XLS)"
                            >
                              <Upload className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {a.bank === "Mercury" && (
                            <button
                              onClick={() => openMercurySync(a)}
                              className="p-2 rounded-lg hover:bg-[#e6f7f5] text-[#9ca3af] hover:text-[#00b9a5] transition-colors"
                              title="Sync via Mercury API"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {a.bank === "Revolut" && (
                            <button
                              onClick={() => openRevolutSync(a)}
                              className="p-2 rounded-lg hover:bg-purple-50 text-[#9ca3af] hover:text-purple-600 transition-colors"
                              title="Sync via Revolut API"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {a.bank === "Wise" && (
                            <button
                              onClick={() => openWiseSync(a)}
                              className="p-2 rounded-lg hover:bg-[#e6f7f5] text-[#9ca3af] hover:text-[#00b9a5] transition-colors"
                              title="Sync via Wise API"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {a.bank === "Dolafy" && (
                            <button
                              onClick={() => { setDolafyTarget(a); setDolafyResult(null); setDolafyOpen(true); }}
                              className="p-2 rounded-lg hover:bg-yellow-50 text-[#9ca3af] hover:text-yellow-600 transition-colors"
                              title="Import Dolafy statement (CSV)"
                            >
                              <Upload className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* Husky import dialog */}
      <Dialog open={huskyOpen} onOpenChange={(v) => { setHuskyOpen(v); if (!v) setHuskyResult(null); }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Import Husky Statement</DialogTitle>
          </DialogHeader>
          {huskyTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-[13px] text-[#6b7280]">
                Conta: <span className="text-[#1a202c] font-semibold">{huskyTarget.name}</span>
              </p>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">XLS file</Label>
                <Input
                  type="file"
                  accept=".xls,.xlsx"
                  ref={huskyFileRef}
                  className="h-10 text-sm rounded-lg border-[#e8eaed]"
                />
                <p className="text-[12px] text-[#9ca3af]">Formato exportado pelo Husky (colunas: Date, Event, Payer, Beneficiary, Payout Amount…)</p>
              </div>
              <button
                onClick={runHuskyDebug}
                disabled={huskyDebugging}
                className="text-[12px] text-[#9ca3af] hover:text-[#374151] underline underline-offset-2 transition-colors"
              >
                {huskyDebugging ? "Inspecting..." : "Inspect file columns"}
              </button>
              {huskyDebug && (
                <div className="rounded-xl border border-[#e8eaed] bg-[#fafbfc] p-3 space-y-2 text-[12px]">
                  <p className="font-semibold text-[#374151]">Headers (row 0):</p>
                  <div className="flex flex-wrap gap-1">
                    {(huskyDebug.headers as string[]).map((h, i) => (
                      <span key={i} className="bg-white border border-[#e8eaed] rounded px-1.5 py-0.5 font-mono text-[11px]">
                        [{i}] {h || <em className="text-[#9ca3af]">vazio</em>}
                      </span>
                    ))}
                  </div>
                  <p className="font-semibold text-[#374151] pt-1">Primeiras linhas de dados:</p>
                  <div className="overflow-auto max-h-48">
                    <pre className="text-[10px] text-[#374151] whitespace-pre-wrap break-all">
                      {JSON.stringify(huskyDebug.sampleRows, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              {huskyResult && (
                <div className={`rounded-xl border p-4 text-[13px] space-y-1 ${huskyResult.error ? "border-rose-200 bg-rose-50" : "border-[#e8eaed] bg-[#fafbfc]"}`}>
                  {huskyResult.error
                    ? <p className="text-rose-600">{huskyResult.error}</p>
                    : <>
                        <p><span className="text-emerald-600 font-semibold">{huskyResult.imported} transactions imported</span></p>
                        <p className="text-[#9ca3af]">{huskyResult.skipped} already existed</p>
                      </>
                  }
                </div>
              )}
              <Button
                onClick={runHuskyImport}
                disabled={huskyImporting}
                className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold"
              >
                {huskyImporting ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Importing...</> : "Importar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revolut sync dialog */}
      <Dialog open={revolutSyncOpen} onOpenChange={(v) => { setRevolutSyncOpen(v); if (!v) setRevolutSyncResult(null); }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Sync via Revolut</DialogTitle>
          </DialogHeader>
          {revolutSyncTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-[13px] text-[#6b7280]">
                Local account: <span className="text-[#1a202c] font-semibold">{revolutSyncTarget.name}</span>
              </p>
              {revolutAccounts.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium text-[#374151]">Revolut account (optional)</Label>
                  <Select value={revolutAccountId} onValueChange={(v) => setRevolutAccountId(v ?? "")}>
                    <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                      <span className="flex-1 text-left text-sm truncate">
                        {revolutAccountId
                          ? revolutAccounts.find(a => a.id === revolutAccountId)?.name ?? revolutAccountId
                          : "All accounts"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All accounts</SelectItem>
                      {revolutAccounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name} · {acc.currency} {new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(acc.balance)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Import from</Label>
                <Input type="date" value={revolutSyncFrom} onChange={(e) => setRevolutSyncFrom(e.target.value)} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              {revolutSyncResult && (
                <div className={`rounded-xl border p-4 text-[13px] space-y-1 ${revolutSyncResult.error ? "border-rose-200 bg-rose-50" : "border-[#e8eaed] bg-[#fafbfc]"}`}>
                  {revolutSyncResult.error
                    ? <p className="text-rose-600">{revolutSyncResult.error}</p>
                    : <>
                        <p><span className="text-emerald-600 font-semibold">{revolutSyncResult.imported} transactions imported</span></p>
                        <p className="text-[#9ca3af]">{revolutSyncResult.skipped} already existed</p>
                      </>
                  }
                </div>
              )}
              <Button onClick={runRevolutSync} disabled={revolutSyncing} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
                {revolutSyncing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : "Sincronizar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
              const connected = companyName && revConnectedCompanies.includes(companyName);
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
                        onClick={() => window.open(`/api/revolut/auth?company=${encodeURIComponent(companyName)}&client_id=${encodeURIComponent(revClientId)}`, "_blank", "width=700,height=700")}
                      >
                        Conectar
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-[#9ca3af]">Sobe o certificado X.509 no Revolut da empresa, pega o Client ID e conecta. 1 conexão cobre todas as contas daquela org.</p>
                </div>
              );
            })()}
            <Button onClick={save} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mercury sync dialog */}
      <Dialog open={mercurySyncOpen} onOpenChange={(v) => { setMercurySyncOpen(v); if (!v) setMercurySyncResult(null); }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Sync via Mercury</DialogTitle>
          </DialogHeader>
          {mercurySyncTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-[13px] text-[#6b7280]">
                Local account: <span className="text-[#1a202c] font-semibold">{mercurySyncTarget.name}</span>
              </p>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Mercury account</Label>
                <Select value={mercuryAccountId} onValueChange={(v) => setMercuryAccountId(v ?? "")}>
                  <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                    <span className="flex-1 text-left truncate text-sm">
                      {mercuryAccountId
                        ? (() => { const m = mercuryAccounts.find(a => a.id === mercuryAccountId); return m ? `${m.kind === "credit" ? "💳 " : ""}${m.legalBusinessName ?? m.name} · ${m.name}` : mercuryAccountId; })()
                        : <span className="text-[#9ca3af]">{mercuryAccounts.length ? "Select" : "Loading..."}</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {mercuryAccounts.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.kind === "credit" ? "💳 " : ""}{m.legalBusinessName ?? m.name} · {m.name}{m.availableBalance != null ? ` — $${new Intl.NumberFormat("en-US").format(m.availableBalance)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Import from</Label>
                <Input type="date" value={mercurySyncFrom} onChange={(e) => setMercurySyncFrom(e.target.value)} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              {mercurySyncResult && (
                <div className="rounded-xl border border-[#e8eaed] p-4 bg-[#fafbfc] text-[13px] space-y-1">
                  <p><span className="text-emerald-600 font-semibold">{mercurySyncResult.imported} transactions imported</span></p>
                  <p className="text-[#9ca3af]">{mercurySyncResult.skipped} already existed</p>
                </div>
              )}
              <Button onClick={runMercurySync} disabled={mercurySyncing || !mercuryAccountId} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
                {mercurySyncing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : "Sincronizar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Wise sync dialog */}
      <Dialog open={wiseSyncOpen} onOpenChange={(v) => { setWiseSyncOpen(v); if (!v) setWiseSyncResult(null); }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Sync via Wise</DialogTitle>
          </DialogHeader>
          {wiseSyncTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-[13px] text-[#6b7280]">
                Local account: <span className="text-[#1a202c] font-semibold">{wiseSyncTarget.name}</span>
              </p>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Wise profile</Label>
                <Select value={wiseProfileId} onValueChange={(v) => {
                  const val = v ?? "";
                  setWiseProfileId(val);
                  // persiste a empresa (profile) escolhida na conta na hora
                  if (val && wiseSyncTarget) {
                    fetch(`/api/accounts/${wiseSyncTarget.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ syncConfig: { wiseProfileId: val } }),
                    });
                  }
                }}>
                  <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {wiseProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">Import from</Label>
                <Input type="date" value={wiseSyncFrom} onChange={(e) => setWiseSyncFrom(e.target.value)} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              </div>
              {wiseSyncResult && (
                <div className={`rounded-xl border p-4 text-[13px] space-y-1 ${wiseSyncResult.error ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                  {wiseSyncResult.error
                    ? <p className="text-rose-600 font-medium">{wiseSyncResult.error}</p>
                    : <>
                        <p className="text-emerald-700 font-semibold">✓ Sync complete! Closing...</p>
                        <p className="text-emerald-600">{wiseSyncResult.imported} transactions imported</p>
                        <p className="text-[#9ca3af]">{wiseSyncResult.alreadyExisted ?? wiseSyncResult.skipped ?? 0} already existed · {wiseSyncResult.parseFailed ?? 0} parse failures</p>
                      </>
                  }
                  {wiseSyncResult.warning && <p className="text-amber-600 pt-1">{wiseSyncResult.warning}</p>}
                </div>
              )}
              <Button onClick={runWiseSync} disabled={wiseSyncing || !wiseProfileId || (!!wiseSyncResult && !wiseSyncResult.error)} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold disabled:opacity-50">
                {wiseSyncing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : "Sincronizar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dolafy import dialog */}
      <Dialog open={dolafyOpen} onOpenChange={(v) => { setDolafyOpen(v); if (!v) { setDolafyResult(null); setDolafyFileName(null); } }}>
        <DialogContent className="rounded-2xl max-w-sm border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Import Dolafy statement</DialogTitle>
          </DialogHeader>
          {dolafyTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-[13px] text-[#6b7280]">
                Local account: <span className="text-[#1a202c] font-semibold">{dolafyTarget.name}</span>
              </p>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#374151]">CSV file</Label>
                <label className={`flex items-center gap-3 w-full h-10 px-3 rounded-lg border cursor-pointer transition-colors ${dolafyFileName ? "border-emerald-300 bg-emerald-50" : "border-[#e8eaed] bg-white hover:bg-[#f9fafb]"}`}>
                  <Upload className={`w-4 h-4 shrink-0 ${dolafyFileName ? "text-emerald-600" : "text-[#9ca3af]"}`} />
                  <span className={`text-[13px] truncate flex-1 ${dolafyFileName ? "text-emerald-700 font-medium" : "text-[#9ca3af]"}`}>
                    {dolafyFileName ?? "Select file..."}
                  </span>
                  <input
                    ref={dolafyFileRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={(e) => setDolafyFileName(e.target.files?.[0]?.name ?? null)}
                  />
                </label>
              </div>
              {dolafyResult && (
                <div className={`rounded-xl border p-4 text-[13px] space-y-1 ${dolafyResult.error ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                  {dolafyResult.error
                    ? <p className="text-rose-600 font-medium">{dolafyResult.error}</p>
                    : <>
                        <p className="text-emerald-700 font-semibold">✓ Import complete! Closing...</p>
                        <p className="text-emerald-600">{dolafyResult.imported} transactions imported</p>
                        <p className="text-[#9ca3af]">{dolafyResult.skipped} already existed ou ignoradas</p>
                      </>
                  }
                </div>
              )}
              <Button
                onClick={runDolafyImport}
                disabled={dolafyImporting || (!!dolafyResult && !dolafyResult.error)}
                className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold disabled:opacity-50"
              >
                {dolafyImporting ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Importing...</> : "Importar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
