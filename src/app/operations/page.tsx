"use client";

import { useEffect, useState } from "react";

type Holding = { id: string; name: string };
type Operation = {
  id: string;
  name: string;
  type: string;
  holding?: { id: string; name: string } | null;
  accounts: { id: string; name: string }[];
};
type Account = {
  id: string;
  name: string;
  bank: string;
  currency: string;
  companyId: string;
  company: { name: string };
  operation?: { id: string; name: string } | null;
};

export default function OperationsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("own");
  const [holdingId, setHoldingId] = useState("");

  async function load() {
    const ops = await fetch("/api/operations");
    if (ops.status === 401) { setForbidden(true); return; }
    setOperations(await ops.json());
    setHoldings(await fetch("/api/holdings").then((r) => r.json()));
    setAccounts(await fetch("/api/accounts").then((r) => r.json()));
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name) return;
    const r = await fetch("/api/operations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, holdingId }),
    });
    setMsg(r.ok ? "✅ operação criada" : "❌ erro");
    setName(""); load();
  }
  async function delOp(id: string) {
    if (!confirm("Remover operação? As contas ficam sem operação.")) return;
    await fetch(`/api/operations?id=${id}`, { method: "DELETE" }); load();
  }
  async function setAccountOperation(acc: Account, operationId: string) {
    await fetch(`/api/accounts/${acc.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: acc.name, bank: acc.bank, currency: acc.currency, companyId: acc.companyId, operationId: operationId || null }),
    });
    load();
  }

  if (forbidden) return <div className="p-6 text-slate-500">Acesso restrito.</div>;

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-6 p-2">
      <div>
        <h1 className="text-xl font-semibold">Operações</h1>
        <p className="text-sm text-slate-500">
          Uma operação cruza empresas. Cada <strong>conta</strong> pertence a uma operação → as transações herdam.
          O operador só vê as contas/transações da operação dele.
        </p>
      </div>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-2">
        <input className={input} placeholder="Nome da operação" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="own">própria (comissão isolada)</option>
          <option value="holding">da holding</option>
        </select>
        <select className={input} value={holdingId} onChange={(e) => setHoldingId(e.target.value)}>
          <option value="">(holding opcional)</option>
          {holdings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <button className={btn} onClick={create} disabled={!name}>Criar operação</button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Operações ({operations.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {operations.map((o) => (
            <div key={o.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{o.name} <span className="text-xs text-slate-400">· {o.type === "holding" ? "da holding" : "própria"}{o.holding ? ` · ${o.holding.name}` : ""}</span></span>
                <button className="text-xs text-red-600 hover:underline" onClick={() => delOp(o.id)}>remover</button>
              </div>
              <div className="mt-1 text-xs text-slate-500">{o.accounts.length} conta(s): {o.accounts.map((a) => a.name).join(", ") || "—"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Contas → atribuir operação</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Conta</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Operação</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">{a.name} <span className="text-xs text-slate-400">· {a.bank}</span></td>
                  <td className="px-3 py-2 text-xs">{a.company?.name}</td>
                  <td className="px-3 py-2">
                    <select className={input} value={a.operation?.id ?? ""} onChange={(e) => setAccountOperation(a, e.target.value)}>
                      <option value="">(sem operação)</option>
                      {operations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
