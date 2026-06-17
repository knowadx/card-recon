"use client";

import { useEffect, useState } from "react";

type Cred = { id: string; issuer: string; company: string; tokenMasked: string; hasToken: boolean };

export default function IntegracoesPage() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    const r = await fetch("/api/credentials");
    if (r.status === 403) { setForbidden(true); return; }
    setCreds(await r.json());
  }
  useEffect(() => { load(); }, []);

  async function del(id: string) {
    await fetch(`/api/credentials?id=${id}`, { method: "DELETE" });
    load();
  }

  if (forbidden) return <div className="p-6 text-slate-500">Acesso restrito a administradores.</div>;

  const metaCreds = creds.filter((c) => c.issuer === "meta");

  return (
    <div className="flex flex-col gap-5 p-2">
      <div>
        <h1 className="text-xl font-semibold">Integrações — Meta</h1>
        <p className="text-sm text-slate-500">
          O Meta agora é conectado <strong>por operação</strong>: cada operador entra com o próprio perfil do Facebook em{" "}
          <a className="underline" href="/operations">Operações</a>. Tokens de banco (Mercury/Wise) e Revolut ficam em{" "}
          <a className="underline" href="/accounts">Accounts</a>. Esta tela (admin) só lista os perfis Meta já conectados.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium mb-2">Perfis Meta conectados ({metaCreds.length})</h2>
        {metaCreds.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum ainda — conecte em <a className="underline" href="/operations">Operações</a>.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {metaCreds.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">{c.company}</td>
                  <td className="py-2 text-xs text-emerald-700">{c.hasToken ? "conectado ✓" : "—"}</td>
                  <td className="py-2 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => del(c.id)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
