"use client";

import { useEffect, useState } from "react";

type Company = { id: string; name: string; holding?: { id: string; name: string } | null };
type Holding = { id: string; name: string; companies: { id: string; name: string }[] };

export default function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [myRole, setMyRole] = useState("");
  const isSuper = myRole === "superadmin";

  async function load() {
    const me = await fetch("/api/me").then((x) => x.ok ? x.json() : null);
    if (me) setMyRole(me.role);
    setHoldings(await fetch("/api/holdings").then((r) => r.json()));
    setCompanies(await fetch("/api/companies").then((r) => r.json()));
  }
  useEffect(() => { load(); }, []);

  async function createHolding() {
    if (!name) return;
    const r = await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setMsg(r.ok ? `✅ holding criado` : `❌ erro`);
    setName("");
    load();
  }
  async function delHolding(id: string) {
    if (!confirm("Remover holding? As empresas ficam sem holding.")) return;
    await fetch(`/api/holdings?id=${id}`, { method: "DELETE" });
    load();
  }
  async function setCompanyHolding(companyId: string, holdingId: string) {
    await fetch(`/api/companies/${companyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...companies.find((c) => c.id === companyId), holdingId: holdingId || null }),
    });
    load();
  }

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-6 p-2">
      <div>
        <h1 className="text-xl font-semibold">Holdings</h1>
        <p className="text-sm text-slate-500">Holding → Empresas → Contas. O acesso dos usuários é concedido por holding.</p>
      </div>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      {isSuper && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 flex items-end gap-2">
          <input className={input} placeholder="Nome do holding" value={name} onChange={(e) => setName(e.target.value)} />
          <button className={btn} onClick={createHolding} disabled={!name}>Criar holding</button>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Holdings ({holdings.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {holdings.map((h) => (
            <div key={h.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.name}</span>
                {isSuper && <button className="text-xs text-red-600 hover:underline" onClick={() => delHolding(h.id)}>remover</button>}
              </div>
              <div className="mt-1 text-xs text-slate-500">{h.companies.length} empresa(s): {h.companies.map((c) => c.name).join(", ") || "—"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Empresas → atribuir holding</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Holding</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">
                    <select className={input} value={c.holding?.id ?? ""} onChange={(e) => setCompanyHolding(c.id, e.target.value)}>
                      <option value="">(sem holding)</option>
                      {holdings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
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
