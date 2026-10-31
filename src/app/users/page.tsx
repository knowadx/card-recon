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
/** Mesmo formato de src/lib/cloudflareAccess.ts (ResultadoAcesso). */
type Acesso =
  | { status: "desligado" }
  | { status: "em_dia"; emails: string[] }
  | { status: "divergente"; incluir: string[]; remover: string[] }
  | { status: "atualizado"; incluidos: string[]; removidos: string[] }
  | { status: "erro"; erro: string };

/** Aviso curto depois de criar/ativar/desativar/remover: só fala da Cloudflare quando deu errado. */
const avisoCloudflare = (c?: Acesso) =>
  c?.status === "erro" ? ` — ⚠️ mas a lista da Cloudflare NÃO foi atualizada (${c.erro})` :
  c?.status === "desligado" ? " — inclua o e-mail na Cloudflare à mão (sincronização desligada)" : "";

export default function UsersPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [holdings, setHoldings] = useState<Item[]>([]);
  const [operations, setOperations] = useState<Item[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [myRole, setMyRole] = useState("");
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const isSuper = myRole === "superadmin";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [holdingIds, setHoldingIds] = useState<string[]>([]);
  const [operationIds, setOperationIds] = useState<string[]>([]);

  async function load() {
    const me = await fetch("/api/me").then((x) => x.ok ? x.json() : null);
    if (me) setMyRole(me.role);
    const r = await fetch("/api/users");
    if (r.status === 403) { setForbidden(true); return; }
    setUsers(await r.json());
    setHoldings(await fetch("/api/holdings").then((x) => x.json()));
    // a lista de operações é global; aqui só as que dá pra conceder (as que eu opero — o servidor confere de novo)
    setOperations(await fetch("/api/operations").then((x) => x.json().then((d) => Array.isArray(d) ? d.filter((o: { podeGerenciar?: boolean }) => o.podeGerenciar) : [])));
    setAcesso(await fetch("/api/users/acesso-cloudflare").then((x) => x.ok ? x.json() : null).catch(() => null));
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const res = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, role, holdingIds, operationIds }),
    });
    const j = await res.json();
    setMsg(j.ok ? `✅ ${email} criado${avisoCloudflare(j.cloudflare)}` : `❌ ${j.error}`);
    if (j.ok) { setEmail(""); setName(""); setRole("member"); setHoldingIds([]); setOperationIds([]); load(); }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    const j = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({}));
    if (j.cloudflare) setMsg(`${body.isActive ? "✅ Ativado" : "✅ Desativado"}${avisoCloudflare(j.cloudflare)}`);
    load();
  }
  async function del(id: string) {
    if (!confirm("Remover usuário?")) return;
    const j = await fetch(`/api/users/${id}`, { method: "DELETE" }).then((x) => x.json()).catch(() => ({}));
    if (j.ok) setMsg(`✅ Removido${avisoCloudflare(j.cloudflare)}`);
    load();
  }
  async function sincronizar() {
    setSincronizando(true);
    const j: Acesso = await fetch("/api/users/acesso-cloudflare", { method: "POST" }).then((x) => x.json()).catch(() => ({ status: "erro", erro: "sem resposta do servidor" }));
    setSincronizando(false);
    setMsg(j.status === "erro" ? `❌ Cloudflare: ${j.erro}` : "✅ Lista da Cloudflare atualizada");
    load();
  }

  if (forbidden) return <div className="p-6 text-slate-500">Acesso restrito a administradores.</div>;

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";
  const toggle = (arr: string[], id: string, on: boolean) => on ? [...arr, id] : arr.filter((x) => x !== id);

  return (
    <div className="flex flex-col gap-6 p-2">
      <h1 className="text-xl font-semibold">Usuários (operadores)</h1>
      <p className="text-sm text-slate-500">Acesso por <strong>Holding</strong> (vê o holding todo) e/ou por <strong>Operação</strong> (vê só as transações marcadas com aquela operação).</p>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}
      {acesso && (
        <div className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${acesso.status === "em_dia" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span>
            {acesso.status === "em_dia" && <>✓ Acesso pela Cloudflare em dia: os {acesso.emails.length} usuários ativos entram, e só eles.</>}
            {acesso.status === "divergente" && <>⚠️ A lista da Cloudflare está diferente dos usuários ativos.{acesso.incluir.length > 0 && <> Falta: {acesso.incluir.join(", ")}.</>}{acesso.remover.length > 0 && <> Sobra: {acesso.remover.join(", ")}.</>}</>}
            {acesso.status === "erro" && <>⚠️ Não consegui conferir a lista da Cloudflare: {acesso.erro}</>}
            {acesso.status === "desligado" && <>Sincronização com a Cloudflare desligada (falta configurar no servidor): inclua e tire os e-mails à mão na política “Equipe PixelFinance”.</>}
          </span>
          {(acesso.status === "divergente" || acesso.status === "erro") && (
            <button className={btn} onClick={sincronizar} disabled={sincronizando}>{sincronizando ? "Sincronizando..." : "Sincronizar agora"}</button>
          )}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
        <h2 className="font-medium">Novo usuário</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">membro</option>
            <option value="admin">admin (gerencia a holding)</option>
            {isSuper && <option value="superadmin">superadmin (tudo)</option>}
          </select>
        </div>
        {role === "superadmin" ? (
          <span className="text-xs text-slate-400">superadmin vê e gerencia tudo</span>
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
        <p className="text-xs text-slate-500">Sem senha: a pessoa entra pelo login da Cloudflare (código por e-mail). Criar, desativar ou remover aqui já inclui ou tira o e-mail da lista de acesso da Cloudflare.</p>
        <button className={btn + " self-start"} onClick={create} disabled={!email}>Criar</button>
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
                    {(isSuper || u.role === "superadmin") && <option value="superadmin">superadmin</option>}
                  </select>
                </td>
                <td className="py-2 text-xs">
                  {u.role === "superadmin" ? <span className="text-slate-400">todos</span> : (
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
                  {u.role === "superadmin" ? <span className="text-slate-400">todas</span> : (
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
