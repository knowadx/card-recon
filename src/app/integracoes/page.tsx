"use client";

import { useEffect, useState } from "react";

type Cred = { id: string; issuer: string; company: string; tokenMasked: string; hasToken: boolean };

export default function IntegracoesPage() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [label, setLabel] = useState("");

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
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-5 p-2">
      <div>
        <h1 className="text-xl font-semibold">Integrações — Meta</h1>
        <p className="text-sm text-slate-500">
          Conecte <strong>um perfil Meta por operação</strong> (Facebook Login). Cada token puxa as contas/BMs/funding que aquele
          perfil controla — base das combinações da Checagem. Tokens de banco (Mercury/Wise) e Revolut ficam em <a className="underline" href="/accounts">Accounts</a>.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
        <h2 className="font-medium">Conectar perfil Meta</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input className={input + " min-w-[220px]"} placeholder="Nome do perfil/operação (ex.: Operação A)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <a className={btn + (label ? "" : " pointer-events-none opacity-50")} href={`/api/meta/auth?label=${encodeURIComponent(label)}`}>
            Conectar Meta
          </a>
        </div>
        <p className="text-xs text-slate-500">Abre o login do Facebook desse perfil → autoriza ads_read + business_management. Precisa ser Tester/Admin do app.</p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium mb-2">Perfis Meta conectados ({metaCreds.length})</h2>
        {metaCreds.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {metaCreds.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">{c.company}</td>
                  <td className="py-2 text-xs text-emerald-700">{c.hasToken ? "conectado ✓" : "—"}</td>
                  <td className="py-2 text-right">
                    <a className="text-xs text-indigo-600 hover:underline mr-3" href={`/api/meta/auth?label=${encodeURIComponent(c.company)}`}>reconectar</a>
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
