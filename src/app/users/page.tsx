"use client";

import { useEffect, useState } from "react";

type Item = { id: string; name: string };
type U = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  holdings: Item[];
  operations: Item[];
};

export default function UsersPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [holdings, setHoldings] = useState<Item[]>([]);
  const [operations, setOperations] = useState<Item[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [holdingIds, setHoldingIds] = useState<string[]>([]);
  const [operationIds, setOperationIds] = useState<string[]>([]);

  async function load() {
    const r = await fetch("/api/users");
    if (r.status === 403) { setForbidden(true); return; }
    setUsers(await r.json());
    setHoldings(await fetch("/api/holdings").then((x) => x.json()));
    setOperations(await fetch("/api/operations").then((x) => x.json().then((d) => Array.isArray(d) ? d : [])));
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const res = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role, holdingIds, operationIds }),
    });
    const j = await res.json();
    setMsg(j.ok ? `✅ ${email} criado` : `❌ ${j.error}`);
    if (j.ok) { setEmail(""); setName(""); setPassword(""); setRole("member"); setHoldingIds([]); setOperationIds([]); load(); }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }
  async function del(id: string) {
    if (!confirm("Remover usuário?")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    load();
  }

  if (forbidden) return <div className="p-6 text-slate-500">Acesso restrito a administradores.</div>;

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";
  const toggle = (arr: string[], id: string, on: boolean) => on ? [...arr, id] : arr.filter((x) => x !== id);

  return (
    <div className="flex flex-col gap-6 p-2">
      <h1 className="text-xl font-semibold">Usuários (operadores)</h1>
      <p className="text-sm text-slate-500">Acesso por <strong>Holding</strong> (vê o holding todo) e/ou por <strong>Operação</strong> (vê só as contas daquela operação).</p>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
        <h2 className="font-medium">Novo usuário</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">membro</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {role === "admin" ? (
          <span className="text-xs text-slate-400">admin vê tudo</span>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-3">
              <span className="text-xs font-medium text-slate-500">Holdings:</span>
              {holdings.map((h) => (
                <label key={h.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={holdingIds.includes(h.id)} onChange={(e) => setHoldingIds((p) => toggle(p, h.id, e.target.checked))} />
                  {h.name}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="text-xs font-medium text-slate-500">Operações:</span>
              {operations.map((o) => (
                <label key={o.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={operationIds.includes(o.id)} onChange={(e) => setOperationIds((p) => toggle(p, o.id, e.target.checked))} />
                  {o.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <button className={btn + " self-start"} onClick={create} disabled={!email || !password}>Criar</button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-1">Email</th><th>Papel</th><th>Holdings</th><th>Operações</th><th>Ativo</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="align-top">
                <td className="py-2">{u.email}<div className="text-xs text-slate-400">{u.name}</div></td>
                <td className="py-2">
                  <select className={input} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                    <option value="member">membro</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="py-2 text-xs">
                  {u.role === "admin" ? <span className="text-slate-400">todos</span> : (
                    <div className="flex flex-wrap gap-2">
                      {holdings.map((h) => (
                        <label key={h.id} className="flex items-center gap-1">
                          <input type="checkbox" checked={u.holdings.some((x) => x.id === h.id)}
                            onChange={(e) => patch(u.id, { holdingIds: toggle(u.holdings.map((x) => x.id), h.id, e.target.checked) })} />
                          {h.name}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 text-xs">
                  {u.role === "admin" ? <span className="text-slate-400">todas</span> : (
                    <div className="flex flex-wrap gap-2">
                      {operations.map((o) => (
                        <label key={o.id} className="flex items-center gap-1">
                          <input type="checkbox" checked={u.operations.some((x) => x.id === o.id)}
                            onChange={(e) => patch(u.id, { operationIds: toggle(u.operations.map((x) => x.id), o.id, e.target.checked) })} />
                          {o.name}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2"><input type="checkbox" checked={u.isActive} onChange={(e) => patch(u.id, { isActive: e.target.checked })} /></td>
                <td className="py-2 text-right"><button className="text-xs text-red-600 hover:underline" onClick={() => del(u.id)}>remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
