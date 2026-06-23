"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Upload, Plus, X, FileText, RefreshCw } from "lucide-react";
import { format } from "date-fns";

type Company = { id: string; name: string; color: string };
type Account = { id: string; name: string; bank: string; currency: string; company: Company };
type Category = { id: string; name: string; type: string; code: string | null };
type Operation = { id: string; name: string };
type Split = { amount: number; amountStr: string; note: string; accountingDate: string; managerialCategoryId: string; accountingCategoryId: string; operationId: string };
type ApiSplit = { id: string; amount: number; note: string | null; accountingDate: string | null; managerialCategory: Category | null; accountingCategory: Category | null; operation?: Operation | null };
type AccountingSplit = { amount: number; amountStr: string; note: string; accountingDate: string; accountingCategoryId: string };
type ApiAccountingSplit = { id: string; amount: number; note: string | null; accountingDate: string | null; accountingCategory: Category | null };
type Document = { id: string; filename: string; path: string };
type Transaction = {
  id: string; date: string; description: string; amount: number; currency: string; reference: string | null;
  ignored: boolean;
  account: Account;
  splits: ApiSplit[];
  accountingSplits: ApiAccountingSplit[];
  documents: Document[];
};

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + currency;
}

const PAGE_SIZE = 100;

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [accountingSplits, setAccountingSplits] = useState<AccountingSplit[]>([]);
  const [splitTab, setSplitTab] = useState<"managerial" | "accounting">("managerial");
  const [savingAccounting, setSavingAccounting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importAccount, setImportAccount] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  // Column filters
  const [colDescription, setColDescription] = useState("");
  const [colCompany, setColCompany] = useState("all");
  const [colAccount, setColAccount] = useState("all");
  const [colStatus, setColStatus] = useState("all");
  const [colStatusAccounting, setColStatusAccounting] = useState("all");
  const [colDirection, setColDirection] = useState("all"); // "all" | "in" | "out"
  const [colManagerial, setColManagerial] = useState("all");
  const [colAccounting, setColAccounting] = useState("all");
  const [colAmountMin, setColAmountMin] = useState("");
  const [colAmountMax, setColAmountMax] = useState("");

  const buildParams = (skip = 0, overrides: Record<string, string> = {}) => {
    const state = {
      filterFrom, filterTo, showIgnored,
      colDescription, colCompany, colAccount, colStatus, colStatusAccounting,
      colManagerial, colAccounting, colAmountMin, colAmountMax, colDirection,
      ...overrides,
    };
    const params = new URLSearchParams();
    // limites do dia no FUSO LOCAL (a tela mostra a data em horário local) → envia em ISO/UTC
    if (state.filterFrom) params.set("from", new Date(`${state.filterFrom}T00:00:00`).toISOString());
    if (state.filterTo) params.set("to", new Date(`${state.filterTo}T23:59:59.999`).toISOString());
    if (state.showIgnored) params.set("showIgnored", "true");
    if (state.colDescription.trim()) params.set("search", state.colDescription.trim());
    if (state.colCompany !== "all") params.set("colCompany", state.colCompany);
    if (state.colAccount !== "all") params.set("colAccount", state.colAccount);
    if (state.colStatus !== "all") params.set("colStatus", state.colStatus);
    if (state.colStatusAccounting !== "all") params.set("colStatusAccounting", state.colStatusAccounting);
    if (state.colDirection === "ignored") {
      params.set("showIgnored", "true");
      params.set("onlyIgnored", "true");
    } else if (state.colDirection !== "all") {
      params.set("colDirection", state.colDirection);
    }
    if (state.colManagerial !== "all") params.set("colManagerial", state.colManagerial);
    if (state.colAccounting !== "all") params.set("colAccounting", state.colAccounting);
    if (state.colAmountMin) params.set("colAmountMin", state.colAmountMin);
    if (state.colAmountMax) params.set("colAmountMax", state.colAmountMax);
    params.set("skip", String(skip));
    params.set("take", String(PAGE_SIZE));
    return params;
  };

  const load = () => {
    fetch(`/api/transactions?${buildParams(0)}`)
      .then((r) => r.json())
      .then((res) => {
        setTransactions(res.data);
        setHasMore(res.hasMore);
        setTotal(res.total);
      });
  };

  const loadMore = async () => {
    setLoadingMore(true);
    const res = await fetch(`/api/transactions?${buildParams(transactions.length)}`).then((r) => r.json());
    setTransactions((prev) => [...prev, ...res.data]);
    setHasMore(res.hasMore);
    setLoadingMore(false);
  };

  // Update a single transaction in state without full reload
  const refreshTx = async (id: string) => {
    const res = await fetch(`/api/transactions/${id}`).then((r) => r.json());
    setTransactions((prev) => prev.map((t) => (t.id === id ? res : t)));
    setSelected((prev) => (prev?.id === id ? res : prev));
  };

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
    fetch("/api/companies").then((r) => r.json()).then(setCompanies);
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/operations").then((r) => r.json()).then((d) => setOperations(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => { load(); }, [filterFrom, filterTo, showIgnored, colCompany, colAccount, colStatus, colStatusAccounting, colManagerial, colAccounting, colDescription, colAmountMin, colAmountMax, colDirection]);

  const openTx = (tx: Transaction) => {
    setSelected(tx);
    setSplitTab("managerial");
    setSplits(
      tx.splits.length > 0
        ? tx.splits.map((s) => ({
            amount: s.amount,
            amountStr: String(s.amount),
            note: s.note || "",
            accountingDate: s.accountingDate ? s.accountingDate.slice(0, 10) : tx.date.slice(0, 10),
            managerialCategoryId: s.managerialCategory?.id || "",
            accountingCategoryId: "",
            operationId: s.operation?.id || "",
          }))
        : [{ amount: tx.amount, amountStr: String(tx.amount), note: "", accountingDate: tx.date.slice(0, 10), managerialCategoryId: "", accountingCategoryId: "", operationId: "" }]
    );
    setAccountingSplits(
      tx.accountingSplits?.length > 0
        ? tx.accountingSplits.map((s) => ({
            amount: s.amount,
            amountStr: String(s.amount),
            note: s.note || "",
            accountingDate: s.accountingDate ? s.accountingDate.slice(0, 10) : tx.date.slice(0, 10),
            accountingCategoryId: s.accountingCategory?.id || "",
          }))
        : [{ amount: tx.amount, amountStr: String(tx.amount), note: "", accountingDate: tx.date.slice(0, 10), accountingCategoryId: "" }]
    );
  };

  const [saving, setSaving] = useState(false);

  const quickSetCategory = async (tx: Transaction, field: "managerialCategoryId" | "accountingCategoryId", categoryId: string) => {
    if (tx.splits.length > 1) return;
    const existing = tx.splits[0];
    const splitData = {
      amount: tx.amount,
      amountStr: String(tx.amount),
      note: existing?.note || "",
      accountingDate: existing?.accountingDate?.slice(0, 10) || tx.date.slice(0, 10),
      managerialCategoryId: existing?.managerialCategory?.id || "",
      accountingCategoryId: existing?.accountingCategory?.id || "",
      operationId: existing?.operation?.id || "",
      [field]: categoryId,
    };
    await fetch(`/api/transactions/${tx.id}/splits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ splits: [splitData] }),
    });
    refreshTx(tx.id);
  };

  // Remainder is the first split (auto-calculated). It's invalid when the absolute
  // remainder is negative, meaning other splits exceed the transaction total.
  // splits[0].amount = remainderAbs * sign, so remainderAbs = splits[0].amount * sign.
  const txSign = selected && selected.amount < 0 ? -1 : 1;
  const splitRemainderNegative = splits.length > 1 && (splits[0].amount * txSign) < -0.001;

  const saveSplits = async () => {
    if (!selected) return;
    if (splitRemainderNegative) {
      alert("The remainder in the first split is negative. Reduce the other split amounts before saving.");
      return;
    }
    setSaving(true);
    // Ensure split amounts always carry the same sign as the transaction
    const sign = selected.amount < 0 ? -1 : 1;
    const splitsToSave = splits.map(s => ({
      ...s,
      amount: Math.abs(s.amount || 0) * sign,
    }));
    await fetch(`/api/transactions/${selected.id}/splits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ splits: splitsToSave }),
    });
    await refreshTx(selected.id);
    setSaving(false);
    setSelected(null);
  };

  const saveAccountingSplits = async () => {
    if (!selected) return;
    setSavingAccounting(true);
    const sign = selected.amount < 0 ? -1 : 1;
    const splitsToSave = accountingSplits.map(s => ({
      ...s,
      amount: Math.abs(s.amount || 0) * sign,
    }));
    await fetch(`/api/transactions/${selected.id}/accounting-splits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ splits: splitsToSave }),
    });
    await refreshTx(selected.id);
    setSavingAccounting(false);
    setSelected(null);
  };

  const totalAbs = selected ? Math.abs(selected.amount) : 0;

  const updateSplitAmountStr = (index: number, raw: string) => {
    setSplits(prev => {
      const sign = selected && selected.amount < 0 ? -1 : 1;
      // Parse absolute value — allow trailing dot/comma while typing
      const absVal = parseFloat(raw.replace(",", ".").replace("-", "")) || 0;
      const signed = absVal * sign;
      // Keep raw string in amountStr so trailing dots/commas aren't stripped mid-typing
      const next = prev.map((s, j) => j === index ? { ...s, amountStr: raw, amount: signed } : s);
      if (index !== 0 && next.length > 1) {
        const otherAbsSum = next.slice(1).reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0);
        const remainderAbs = Math.round((totalAbs - otherAbsSum) * 100) / 100;
        const remainder = remainderAbs * sign;
        next[0] = { ...next[0], amount: remainder, amountStr: String(remainder) };
      }
      return next;
    });
  };

  const addSplit = () => {
    setSplits(prev => [...prev, { amount: 0, amountStr: "", note: "", accountingDate: selected?.date.slice(0, 10) ?? "", managerialCategoryId: "", accountingCategoryId: "", operationId: "" }]);
  };

  const uploadDoc = async (file: File) => {
    if (!selected) return;
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`/api/transactions/${selected.id}/documents`, { method: "POST", body: fd });
    refreshTx(selected.id);
  };

  const importCSV = async () => {
    if (!fileRef.current?.files?.[0] || !importAccount) return;
    setImporting(true);
    const fd = new FormData();
    fd.append("file", fileRef.current.files[0]);
    fd.append("accountId", importAccount);
    const res = await fetch("/api/transactions/import", { method: "POST", body: fd }).then((r) => r.json());
    setImporting(false);
    setImportOpen(false);
    alert(`${res.imported} transactions imported.`);
    load();
  };

  const managerial = categories.filter((c) => c.type === "MANAGERIAL");
  const accounting = categories.filter((c) => c.type === "ACCOUNTING");
  const splitTotal = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const vatCategory = managerial.find(c => c.name === "VAT Payment");

  const applyVatSplit = () => {
    if (!selected || !vatCategory) return;
    const total = selected.amount;
    const sign = total < 0 ? -1 : 1;
    const abs = Math.abs(total);
    const vatAbs = parseFloat((abs * 0.24 / 1.24).toFixed(2));
    const baseAbs = parseFloat((abs - vatAbs).toFixed(2));
    const date = selected.date.slice(0, 10);
    setSplits([
      { amount: sign * baseAbs, amountStr: String(sign * baseAbs), note: "", accountingDate: date, managerialCategoryId: "", accountingCategoryId: "", operationId: "" },
      { amount: sign * vatAbs,  amountStr: String(sign * vatAbs),  note: "VAT 24%", accountingDate: date, managerialCategoryId: vatCategory.id, accountingCategoryId: "", operationId: "" },
    ]);
  };

  const visibleTransactions = transactions;

const allVisibleSelected = visibleTransactions.length > 0 && visibleTransactions.every(t => selectedIds.has(t.id));
  const [selectingAll, setSelectingAll] = useState(false);

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleTransactions.map(t => t.id)));
    }
  };

  const selectAllFiltered = async () => {
    setSelectingAll(true);
    const params = buildParams(0);
    params.delete("skip");
    params.delete("take");
    const res = await fetch(`/api/transactions/ids?${params}`);
    const { ids } = await res.json();
    setSelectedIds(new Set(ids));
    setSelectingAll(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkIgnore = async (ignored: boolean) => {
    await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], ignored }),
    });
    setSelectedIds(new Set());
    load();
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} transaction(s)?`)) return;
    await fetch("/api/transactions/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    setSelectedIds(new Set());
    load();
  };

  const bulkCategorize = async (type: "managerial" | "accounting", categoryId: string) => {
    await fetch("/api/transactions/bulk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [...selectedIds],
        ...(type === "managerial" ? { managerialCategoryId: categoryId } : { accountingCategoryId: categoryId }),
      }),
    });
    setSelectedIds(new Set());
    load();
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Transactions</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">
            {visibleTransactions.length > 0 ? `${visibleTransactions.length} transactions` : "No transactions found"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date range picker */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[
                { label: "This month", from: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0,10); }, to: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth()+1, 0).toISOString().slice(0,10); } },
                { label: "Last month", from: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth()-1, 1).toISOString().slice(0,10); }, to: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 0).toISOString().slice(0,10); } },
                { label: "This year", from: () => `${new Date().getFullYear()}-01-01`, to: () => `${new Date().getFullYear()}-12-31` },
              ].map(({ label, from, to }) => {
                const isActive = filterFrom === from() && filterTo === to();
                return (
                  <button
                    key={label}
                    onClick={() => { setFilterFrom(from()); setFilterTo(to()); }}
                    className={`h-9 px-3 text-[13px] rounded-lg border font-medium transition-colors whitespace-nowrap ${isActive ? "border-[#00b9a5] bg-[#e6f7f5] text-[#00b9a5]" : "border-[#e8eaed] bg-white text-[#6b7280] hover:bg-[#f9fafb]"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1 bg-white border border-[#e8eaed] rounded-lg px-2.5 h-9">
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="text-[13px] text-[#374151] bg-transparent focus:outline-none w-28"
              />
              <span className="text-[#d1d5db] text-sm">→</span>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="text-[13px] text-[#374151] bg-transparent focus:outline-none w-28"
              />
              {(filterFrom || filterTo) && (
                <button onClick={() => { setFilterFrom(""); setFilterTo(""); }} className="text-[#9ca3af] hover:text-[#374151] ml-0.5">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowIgnored(v => !v)}
            className={`h-9 px-3 text-sm rounded-lg border font-medium transition-colors ${showIgnored ? "border-amber-300 bg-amber-50 text-amber-700" : "border-[#e8eaed] bg-white text-[#6b7280] hover:bg-[#f9fafb]"}`}
          >
            {showIgnored ? "Hiding ignored" : "Ignored"}
          </button>
        </div>
      </div>

      {/* Direction toggle */}
      <div className="flex items-center gap-1 px-8 py-2.5 bg-white border-b border-[#e8eaed]">
        {[
          { value: "all", label: "All" },
          { value: "in", label: "In", activeClass: "border-emerald-400 bg-emerald-50 text-emerald-700" },
          { value: "out", label: "Out", activeClass: "border-rose-400 bg-rose-50 text-rose-600" },
          { value: "ignored", label: "Ignored", activeClass: "border-amber-400 bg-amber-50 text-amber-700" },
        ].map(({ value, label, activeClass }) => (
          <button
            key={value}
            onClick={() => setColDirection(colDirection === value ? "all" : value)}
            className={`h-7 px-3 text-[12px] rounded-lg border font-medium transition-colors ${colDirection === value ? (activeClass ?? "border-[#00b9a5] bg-[#e6f7f5] text-[#00b9a5]") : "border-[#e8eaed] bg-white text-[#6b7280] hover:bg-[#f9fafb]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-8 py-3 bg-[#e6f7f5] border-b border-[#b2e8e2] text-[#1a202c] text-[13px] z-20">
          <span className="font-semibold text-[#00907e]">{selectedIds.size} selected</span>
          {allVisibleSelected && total > transactions.length && selectedIds.size < total && (
            <button
              onClick={selectAllFiltered}
              disabled={selectingAll}
              className="text-[12px] text-[#00b9a5] hover:text-[#00907e] font-medium transition-colors disabled:opacity-50"
            >
              {selectingAll ? "Loading..." : `Select all ${total}`}
            </button>
          )}
          {selectedIds.size === total && total > transactions.length && (
            <span className="text-[12px] text-[#6b7280]">All {total} selected</span>
          )}
          <div className="w-px h-4 bg-[#b2e8e2]" />
          <div className="flex items-center gap-2">
            <span className="text-[#6b7280]">Managerial:</span>
            <Select value="" onValueChange={(v) => { if (v) bulkCategorize("managerial", v === "__clear__" ? "" : v); }}>
              <SelectTrigger className="h-7 text-[12px] bg-white border-[#b2e8e2] text-[#374151] rounded-lg px-2 min-w-[130px] focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__">— Limpar</SelectItem>
                {managerial.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#6b7280]">Accounting:</span>
            <Select value="" onValueChange={(v) => { if (v) bulkCategorize("accounting", v === "__clear__" ? "" : v); }}>
              <SelectTrigger className="h-7 text-[12px] bg-white border-[#b2e8e2] text-[#374151] rounded-lg px-2 min-w-[130px] focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__">— Limpar</SelectItem>
                {accounting.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          {transactions.filter(t => selectedIds.has(t.id)).some(t => t.ignored)
            ? <button onClick={() => bulkIgnore(false)} className="text-[12px] text-emerald-600 hover:text-emerald-800 font-medium transition-colors">Restore</button>
            : <button onClick={() => bulkIgnore(true)} className="text-[12px] text-amber-600 hover:text-amber-800 font-medium transition-colors">Ignore</button>
          }
          <div className="w-px h-4 bg-[#b2e8e2]" />
          <button
            onClick={bulkDelete}
            className="text-[12px] text-rose-500 hover:text-rose-700 font-medium transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-[12px] text-[#9ca3af] hover:text-[#374151] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white border-b border-[#e8eaed] z-10">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-[#d1d5db] accent-[#00b9a5] cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-28">Date</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider" style={{ width: 280, maxWidth: 280 }}>Description</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-36">Company</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-36">Account</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-24">Mgmt. St.</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-40">Mgmt. Category</th>
              <th className="text-right px-8 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-40">Amount</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-24">Acc. St.</th>
              <th className="text-left px-4 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider w-40">Acc. Category</th>
            </tr>
            <tr className="bg-[#f8fafc] border-b border-[#e8eaed]">
              <th className="px-4 py-2 w-10" />
              <th className="px-2 py-2 w-28" />
              {/* Descrição */}
              <th className="px-2 py-2">
                <input
                  value={colDescription}
                  onChange={(e) => setColDescription(e.target.value)}
                  placeholder="Search..."
                  className="w-full h-7 px-2.5 text-[12px] text-[#374151] bg-white border border-[#e8eaed] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00b9a5]/30 placeholder:text-[#d1d5db]"
                />
              </th>
              {/* Empresa */}
              <th className="px-2 py-2 w-36">
                <Select value={colCompany} onValueChange={(v) => { setColCompany(v ?? "all"); setColAccount("all"); }}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colCompany === "all" ? <span className="text-[#9ca3af]">All</span> : (companies.find(c => c.id === colCompany)?.name ?? "All")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </th>
              {/* Conta */}
              <th className="px-2 py-2 w-36">
                <Select value={colAccount} onValueChange={(v) => setColAccount(v ?? "all")}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colAccount === "all" ? <span className="text-[#9ca3af]">All</span> : ((colCompany === "all" ? accounts : accounts.filter(a => a.company.id === colCompany)).find(a => a.id === colAccount)?.name ?? "All")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {(colCompany === "all" ? accounts : accounts.filter(a => a.company.id === colCompany)).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </th>
              {/* Status Gerencial */}
              <th className="px-2 py-2 w-24">
                <Select value={colStatus} onValueChange={(v) => setColStatus(v ?? "all")}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colStatus === "all" ? <span className="text-[#9ca3af]">All</span> : colStatus === "categorized" ? "Categ." : "Pending"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="categorized">Categorized</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </th>
              {/* Cat. Gerencial */}
              <th className="px-2 py-2 w-40">
                <Select value={colManagerial} onValueChange={(v) => setColManagerial(v ?? "all")}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colManagerial === "all" ? <span className="text-[#9ca3af]">All</span> : (managerial.find(c => c.id === colManagerial)?.name ?? "All")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {managerial.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </th>
              {/* Valor min/max */}
              <th className="px-2 py-2 w-40">
                <div className="flex gap-1">
                  <input
                    value={colAmountMin}
                    onChange={(e) => setColAmountMin(e.target.value)}
                    placeholder="Min"
                    type="number"
                    className="w-1/2 h-7 px-1.5 text-[12px] text-[#374151] bg-white border border-[#e8eaed] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00b9a5]/30 placeholder:text-[#d1d5db]"
                  />
                  <input
                    value={colAmountMax}
                    onChange={(e) => setColAmountMax(e.target.value)}
                    placeholder="Max"
                    type="number"
                    className="w-1/2 h-7 px-1.5 text-[12px] text-[#374151] bg-white border border-[#e8eaed] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00b9a5]/30 placeholder:text-[#d1d5db]"
                  />
                </div>
              </th>
              {/* Status Contábil */}
              <th className="px-2 py-2 w-24">
                <Select value={colStatusAccounting} onValueChange={(v) => setColStatusAccounting(v ?? "all")}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colStatusAccounting === "all" ? <span className="text-[#9ca3af]">All</span> : colStatusAccounting === "categorized" ? "Categ." : "Pending"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="categorized">Categorized</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </th>
              {/* Cat. Contábil */}
              <th className="px-2 py-2 w-40">
                <Select value={colAccounting} onValueChange={(v) => setColAccounting(v ?? "all")}>
                  <SelectTrigger className="h-7 text-[12px] border-[#e8eaed] bg-white rounded-lg w-full">
                    <span className="truncate text-left flex-1 text-[12px]">
                      {colAccounting === "all" ? <span className="text-[#9ca3af]">All</span> : (accounting.find(c => c.id === colAccounting)?.name ?? "All")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {accounting.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-24 text-[#9ca3af] text-sm">
                  {"No transactions found."}
                </td>
              </tr>
            )}
            {visibleTransactions.map((tx, idx) => (
              <tr
                key={tx.id}
                className={`transition-colors group border-b border-[#f3f4f6] ${selectedIds.has(tx.id) ? "bg-[#f0fdf9]" : tx.ignored ? "opacity-50" : idx % 2 === 0 ? "bg-[#fafbfc]" : "bg-white"} hover:bg-[#f0fdf9]`}
              >
                <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                    className="w-4 h-4 rounded border-[#d1d5db] accent-[#00b9a5] cursor-pointer"
                  />
                </td>
                <td className="px-4 py-4 text-[13px] text-[#9ca3af] tabular-nums whitespace-nowrap cursor-pointer" onClick={() => openTx(tx)}>
                  {format(new Date(tx.date), "dd MMM yyyy")}
                </td>
                <td className="px-4 py-4 cursor-pointer overflow-hidden" style={{ width: 280, maxWidth: 280 }} onClick={() => openTx(tx)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[#1a202c]">{tx.description}</span>
                    {tx.splits.length > 0 && (
                      <span className="shrink-0 text-[11px] text-[#00b9a5] bg-[#e6f7f5] px-2 py-0.5 rounded-full font-medium">
                        {tx.splits.length} splits
                      </span>
                    )}
                    {tx.documents.length > 0 && (
                      <FileText className="shrink-0 w-3.5 h-3.5 text-[#9ca3af]" />
                    )}
                  </div>
                  {tx.reference && (
                    <p className="text-[11px] text-[#d1d5db] truncate mt-0.5 font-mono">{tx.reference}</p>
                  )}
                </td>
                <td className="px-4 py-4 text-[13px] text-[#6b7280] whitespace-nowrap cursor-pointer" onClick={() => openTx(tx)}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tx.account.company.color }} />
                    {tx.account.company.name}
                  </div>
                </td>
                <td className="px-4 py-4 text-[13px] text-[#6b7280] whitespace-nowrap cursor-pointer" onClick={() => openTx(tx)}>
                  {tx.account.bank}
                </td>
                <td className="px-4 py-4 cursor-pointer" onClick={() => openTx(tx)}>
                  {tx.splits.some(s => s.managerialCategory)
                    ? <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Categorized
                      </span>
                    : <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Pending
                      </span>
                  }
                </td>
                <td className="px-2 py-2 w-44" onClick={(e) => e.stopPropagation()}>
                  {tx.splits.length > 1
                    ? <span className="truncate block px-2 text-[13px] text-[#374151] cursor-pointer" onClick={() => openTx(tx)} title={tx.splits.map(s => s.managerialCategory?.name).filter(Boolean).join(", ")}>
                        {[...new Set(tx.splits.map(s => s.managerialCategory?.name).filter(Boolean))].join(", ") || <span className="text-[#d1d5db]">—</span>}
                      </span>
                    : <Select value={tx.splits[0]?.managerialCategory?.id || "none"} onValueChange={(v) => quickSetCategory(tx, "managerialCategoryId", v === "none" ? "" : (v ?? ""))}>
                        <SelectTrigger className="w-full h-8 text-[12px] text-[#374151] bg-transparent border border-transparent hover:border-[#e8eaed] focus:border-[#00b9a5] focus:ring-1 focus:ring-[#00b9a5]/20 rounded-lg px-2 transition-all">
                          <span className="flex-1 text-left truncate text-[12px]">
                            {managerial.find(c => c.id === tx.splits[0]?.managerialCategory?.id)?.name ?? <span className="text-[#9ca3af]">— Managerial</span>}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none"><span className="text-[#9ca3af]">— Managerial</span></SelectItem>
                          {managerial.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                  }
                </td>
                <td className={`px-8 py-4 text-right text-[14px] tabular-nums font-semibold whitespace-nowrap cursor-pointer ${tx.amount >= 0 ? "text-emerald-600" : "text-rose-500"}`} onClick={() => openTx(tx)}>
                  {tx.amount >= 0 ? "+" : "−"}{fmt(Math.abs(tx.amount), tx.currency)}
                </td>
                <td className="px-4 py-4 cursor-pointer" onClick={() => openTx(tx)}>
                  {tx.accountingSplits?.some(s => s.accountingCategory)
                    ? <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Categorized
                      </span>
                    : <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Pending
                      </span>
                  }
                </td>
                <td className="px-2 py-2 w-44 cursor-pointer" onClick={() => openTx(tx)}>
                  <span className="truncate block px-2 text-[13px] text-[#374151]">
                    {[...new Set((tx.accountingSplits ?? []).map(s => s.accountingCategory?.name).filter(Boolean))].join(", ") || <span className="text-[#d1d5db]">—</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Load more */}
        {hasMore && (
          <div className="flex flex-col items-center py-6 gap-2">
            <p className="text-[13px] text-[#9ca3af]">Showing {transactions.length} of {total} transactions</p>
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="rounded-lg border-[#e8eaed] text-[13px]">
              {loadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
        {!hasMore && transactions.length > 0 && (
          <p className="text-center text-[12px] text-[#d1d5db] py-4">{total} transactions total</p>
        )}
      </div>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="rounded-2xl max-w-md border-[#e8eaed] shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold text-[#1a202c]">Import CSV Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">Destination account</Label>
              <Select value={importAccount} onValueChange={(v) => setImportAccount(v ?? "")}>
                <SelectTrigger className="h-10 text-sm rounded-lg border-[#e8eaed]">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {a.bank} · {a.currency}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#374151]">CSV File</Label>
              <Input type="file" accept=".csv" ref={fileRef} className="h-10 text-sm rounded-lg border-[#e8eaed]" />
              <p className="text-[12px] text-[#9ca3af]">Supported: Mercury, Wise, Revolut, Husky. Columns detected automatically.</p>
            </div>
            <Button onClick={importCSV} disabled={importing} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold">
              {importing ? "Importing..." : "Import"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transaction detail panel */}
      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <DialogContent className="!max-w-5xl w-[900px] max-h-[90vh] overflow-y-auto rounded-2xl border-[#e8eaed] shadow-xl">
          {selected && (
            <div className="space-y-6">
              <div>
                <DialogTitle className="text-[17px] font-bold text-[#1a202c] leading-tight">{selected.description}</DialogTitle>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[13px] text-[#9ca3af]">{format(new Date(selected.date), "dd MMM yyyy")}</span>
                  <span className="text-[#e8eaed]">·</span>
                  <span className="text-[13px] text-[#9ca3af]">{selected.account.bank} · {selected.account.name}</span>
                </div>
                <p className={`text-3xl font-bold tabular-nums mt-3 ${selected.amount >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                  {selected.amount >= 0 ? "+" : "−"}{fmt(Math.abs(selected.amount), selected.currency)}
                </p>
              </div>

              <Separator className="bg-[#f3f4f6]" />

              <div className="space-y-4">
                {/* Tabs */}
                <div className="flex items-center gap-1 bg-[#f3f4f6] rounded-lg p-1">
                  {(["managerial", "accounting"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setSplitTab(tab)}
                      className={`flex-1 h-8 text-[13px] font-semibold rounded-md transition-colors capitalize ${splitTab === tab ? "bg-white text-[#1a202c] shadow-sm" : "text-[#6b7280] hover:text-[#374151]"}`}
                    >
                      {tab === "managerial" ? "Managerial" : "Accounting"}
                    </button>
                  ))}
                </div>

                {/* Managerial tab */}
                {splitTab === "managerial" && (
                  <>
                    <div className="flex items-center justify-end gap-2">
                      {vatCategory && (
                        <Button size="sm" variant="outline" onClick={applyVatSplit}
                          className="h-8 text-[13px] rounded-lg border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 font-medium">
                          VAT 24%
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 text-[13px] rounded-lg border-[#e8eaed] font-medium" onClick={addSplit}>
                        <Plus className="w-3.5 h-3.5 mr-1.5" />Add split
                      </Button>
                    </div>

                    {splits.map((s, i) => (
                      <div key={i} className="border border-[#e8eaed] rounded-xl p-3 bg-[#fafbfc]">
                        <div className="flex gap-2 items-end">
                          <div className="w-24 shrink-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">
                              Amount{i === 0 && splits.length > 1 && <span className="ml-1 font-normal">(rem.)</span>}
                            </Label>
                            <Input
                              type="text" inputMode="decimal"
                              value={i === 0 && splits.length > 1 ? String(s.amount) : s.amountStr}
                              readOnly={i === 0 && splits.length > 1}
                              placeholder="0.00"
                              onChange={(e) => updateSplitAmountStr(i, e.target.value)}
                              onFocus={(e) => { if (e.target.value === "0") e.target.select(); }}
                              className={`h-8 text-sm rounded-lg border-[#e8eaed] mt-1 tabular-nums ${i === 0 && splits.length > 1 ? "bg-[#f3f4f6] text-[#6b7280] cursor-default" : ""}`}
                            />
                          </div>
                          <div className="w-36 shrink-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Eff. Date</Label>
                            <input type="date" value={s.accountingDate}
                              onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, accountingDate: e.target.value } : x))}
                              className="mt-1 w-full h-8 px-2 text-sm text-[#374151] bg-white border border-[#e8eaed] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00b9a5]/30"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Category</Label>
                            <Select value={s.managerialCategoryId || "none"} onValueChange={(v) =>
                              setSplits(splits.map((x, j) => j === i ? { ...x, managerialCategoryId: !v || v === "none" ? "" : v } : x))
                            }>
                              <SelectTrigger className="w-full h-8 text-sm rounded-lg border-[#e8eaed] mt-1">
                                <span className="flex-1 text-left truncate text-sm">
                                  {managerial.find(c => c.id === s.managerialCategoryId)?.name ?? <span className="text-[#9ca3af]">—</span>}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">—</SelectItem>
                                {managerial.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1 min-w-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Operação</Label>
                            <Select value={s.operationId || "none"} onValueChange={(v) =>
                              setSplits(splits.map((x, j) => j === i ? { ...x, operationId: !v || v === "none" ? "" : v } : x))
                            }>
                              <SelectTrigger className="w-full h-8 text-sm rounded-lg border-[#e8eaed] mt-1">
                                <span className="flex-1 text-left truncate text-sm">
                                  {operations.find(o => o.id === s.operationId)?.name ?? <span className="text-[#9ca3af]">—</span>}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">—</SelectItem>
                                {operations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1 min-w-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Note</Label>
                            <Input value={s.note} onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                              placeholder="Note..." className="h-8 text-sm rounded-lg border-[#e8eaed] mt-1" />
                          </div>
                          {splits.length > 1 && i > 0 && (
                            <button className="mb-1 text-[#9ca3af] hover:text-rose-500 transition-colors shrink-0"
                              onClick={() => setSplits(prev => {
                                const next = prev.filter((_, j) => j !== i);
                                const sign = selected && selected.amount < 0 ? -1 : 1;
                                const otherAbsSum = next.slice(1).reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0);
                                const remainderAbs = Math.round((totalAbs - otherAbsSum) * 100) / 100;
                                next[0] = { ...next[0], amount: remainderAbs * sign, amountStr: String(remainderAbs * sign) };
                                return next;
                              })}>
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {splits.length > 1 && splitRemainderNegative && (
                      <p className="text-[13px] text-rose-500 font-medium flex items-center gap-1.5">
                        <span>⚠️</span> Split amounts exceed the transaction total.
                      </p>
                    )}
                    {splits.length > 1 && (
                      <p className={`text-[13px] text-right tabular-nums font-medium ${Math.abs(Math.abs(splitTotal) - totalAbs) > 0.01 ? "text-rose-500" : "text-emerald-600"}`}>
                        {fmt(Math.abs(splitTotal), selected.currency)} / {fmt(totalAbs, selected.currency)}
                      </p>
                    )}
                    <Button onClick={saveSplits} disabled={saving || splitRemainderNegative} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                      {saving ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save categorization"}
                    </Button>
                  </>
                )}

                {/* Accounting tab */}
                {splitTab === "accounting" && (
                  <>
                    <div className="flex items-center justify-end">
                      <Button size="sm" variant="outline" className="h-8 text-[13px] rounded-lg border-[#e8eaed] font-medium"
                        onClick={() => setAccountingSplits(prev => [...prev, { amount: 0, amountStr: "", note: "", accountingDate: selected?.date.slice(0, 10) ?? "", accountingCategoryId: "" }])}>
                        <Plus className="w-3.5 h-3.5 mr-1.5" />Add split
                      </Button>
                    </div>

                    {accountingSplits.map((s, i) => (
                      <div key={i} className="border border-[#e8eaed] rounded-xl p-3 bg-[#fafbfc]">
                        <div className="flex gap-2 items-end">
                          <div className="w-24 shrink-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Amount</Label>
                            <Input type="text" inputMode="decimal"
                              value={s.amountStr}
                              placeholder="0.00"
                              onChange={(e) => {
                                const sign = selected && selected.amount < 0 ? -1 : 1;
                                const absVal = parseFloat(e.target.value.replace(",", ".").replace("-", "")) || 0;
                                setAccountingSplits(prev => prev.map((x, j) => j === i ? { ...x, amountStr: e.target.value, amount: absVal * sign } : x));
                              }}
                              className="h-8 text-sm rounded-lg border-[#e8eaed] mt-1 tabular-nums"
                            />
                          </div>
                          <div className="w-36 shrink-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Acc. Date</Label>
                            <input type="date" value={s.accountingDate}
                              onChange={(e) => setAccountingSplits(prev => prev.map((x, j) => j === i ? { ...x, accountingDate: e.target.value } : x))}
                              className="mt-1 w-full h-8 px-2 text-sm text-[#374151] bg-white border border-[#e8eaed] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00b9a5]/30"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Category</Label>
                            <Select value={s.accountingCategoryId || "none"} onValueChange={(v) =>
                              setAccountingSplits(prev => prev.map((x, j) => j === i ? { ...x, accountingCategoryId: !v || v === "none" ? "" : v } : x))
                            }>
                              <SelectTrigger className="w-full h-8 text-sm rounded-lg border-[#e8eaed] mt-1">
                                <span className="flex-1 text-left truncate text-sm">
                                  {accounting.find(c => c.id === s.accountingCategoryId)?.name ?? <span className="text-[#9ca3af]">—</span>}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">—</SelectItem>
                                {accounting.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1 min-w-0">
                            <Label className="text-[11px] font-medium text-[#9ca3af]">Note</Label>
                            <Input value={s.note} onChange={(e) => setAccountingSplits(prev => prev.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                              placeholder="Note..." className="h-8 text-sm rounded-lg border-[#e8eaed] mt-1" />
                          </div>
                          {accountingSplits.length > 1 && i > 0 && (
                            <button className="mb-1 text-[#9ca3af] hover:text-rose-500 transition-colors shrink-0"
                              onClick={() => setAccountingSplits(prev => prev.filter((_, j) => j !== i))}>
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    <Button onClick={saveAccountingSplits} disabled={savingAccounting} className="w-full h-10 text-sm rounded-lg bg-[#00b9a5] hover:bg-[#00a896] text-white font-semibold disabled:opacity-50">
                      {savingAccounting ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save accounting"}
                    </Button>
                  </>
                )}
              </div>

              <Separator className="bg-[#f3f4f6]" />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-[#1a202c]">Documents</span>
                  <button
                    className="text-[13px] text-[#00b9a5] hover:text-[#00a896] flex items-center gap-1.5 font-medium transition-colors"
                    onClick={() => docRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5" />Attach
                  </button>
                  <input type="file" ref={docRef} className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
                </div>
                {selected.documents.length === 0
                  ? <p className="text-[13px] text-[#9ca3af]">No documents attached.</p>
                  : selected.documents.map((d) => (
                      <a key={d.id} href={d.path} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2.5 text-[13px] text-[#374151] hover:text-[#00b9a5] transition-colors">
                        <FileText className="w-4 h-4 shrink-0 text-[#9ca3af]" />{d.filename}
                      </a>
                    ))
                }
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
