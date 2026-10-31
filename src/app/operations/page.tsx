"use client";

import { useEffect, useState } from "react";

type Operation = {
  id: string;
  name: string;
  type: string;
  podeGerenciar: boolean; // sou membro (ou superadmin): conecto o Meta e removo
  metaConnected?: boolean;
  metaUpdatedAt?: string | null;
  metaProfile?: string | null;
};

export default function OperationsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("own");

  async function load() {
    const ops = await fetch("/api/operations");
    if (ops.status === 401) { setForbidden(true); return; }
    setOperations(await ops.json());
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name) return;
    const r = await fetch("/api/operations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    });
    setMsg(r.ok ? "✅ operação criada" : "❌ erro");
    setName(""); load();
  }
  async function delOp(id: string) {
    if (!confirm("Remover operação? Os splits marcados com ela ficam sem operação, e a conexão Meta e os acessos dela somem.")) return;
    await fetch(`/api/operations?id=${id}`, { method: "DELETE" }); load();
  }
  async function disconnectMeta(id: string) {
    if (!confirm("Desconectar o perfil Meta desta operação?")) return;
    await fetch("/api/meta/disconnect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: id }),
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
          Operação é uma <strong>etiqueta global</strong> (como categoria), carimbada no <strong>split da transação</strong> —
          não é presa a empresa, conta nem holding. Quem é membro de uma operação vê as transações marcadas com ela
          e conecta o Meta dela.
        </p>
      </div>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-2">
        <input className={input} placeholder="Nome da operação" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="own">própria (comissão isolada)</option>
          <option value="holding">da holding</option>
        </select>
        <button className={btn} onClick={create} disabled={!name}>Criar operação</button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Operações ({operations.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {operations.map((o) => (
            <div key={o.id} className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{o.name} <span className="text-xs text-slate-400">· {o.type === "holding" ? "da holding" : "própria"}</span></span>
                {o.podeGerenciar && <button className="text-xs text-red-600 hover:underline" onClick={() => delOp(o.id)}>remover</button>}
              </div>
              {o.podeGerenciar && <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                {o.metaConnected ? (
                  <span className="text-xs text-emerald-700">
                    Meta conectado ✓{o.metaProfile ? <span className="text-slate-500"> · {o.metaProfile}</span> : ""}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Meta não conectado</span>
                )}
                <div className="flex items-center gap-3">
                  <a className="text-xs text-indigo-600 hover:underline" href={`/api/meta/auth?operationId=${o.id}`}>
                    {o.metaConnected ? "reconectar Meta" : "Conectar Meta"}
                  </a>
                  {o.metaConnected && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => disconnectMeta(o.id)}>desconectar</button>
                  )}
                </div>
              </div>}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">A operação é atribuída em <strong>Transactions</strong> (no split de cada transação).</p>
      </section>
    </div>
  );
}
