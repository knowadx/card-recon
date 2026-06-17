"use client";

import { useEffect, useState } from "react";

type Company = { id: string; name: string };
type Cred = { id: string; issuer: string; company: string; tokenMasked: string; hasToken: boolean };

// Tokens de banco (Mercury/Wise) ficam NA CONTA (1 token por conta) — tela Accounts.
// Aqui só o token do Meta (cobre as contas de anúncio que o token enxerga), por empresa.
const ISSUERS = [{ id: "meta", label: "Meta (Marketing API)" }];

export default function IntegracoesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [creds, setCreds] = useState<Cred[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function load() {
    const r = await fetch("/api/credentials");
    if (r.status === 403) { setForbidden(true); return; }
    setCreds(await r.json());
    setCompanies(await fetch("/api/companies").then((x) => x.json()));
  }
  useEffect(() => { load(); }, []);

  async function save(issuer: string, company: string) {
    const k = `${issuer}:${company}`;
    const token = draft[k];
    if (!token) return;
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuer, company, token }),
    });
    const j = await res.json();
    setMsg(j.ok ? `✅ ${issuer} / ${company} salvo` : `❌ ${j.error}`);
    setDraft((d) => ({ ...d, [k]: "" }));
    load();
  }
  async function del(id: string) {
    await fetch(`/api/credentials?id=${id}`, { method: "DELETE" });
    load();
  }

  if (forbidden) return <div className="p-6 text-slate-500">Acesso restrito a administradores.</div>;

  const credFor = (issuer: string, company: string) => creds.find((c) => c.issuer === issuer && c.company === company);
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-5 p-2">
      <div>
        <h1 className="text-xl font-semibold">Integrações</h1>
        <p className="text-sm text-slate-500">
          Token do <strong>Meta</strong> por empresa (define quais contas de anúncio você controla, base da checagem).
          Tokens de <strong>banco</strong> (Mercury/Wise) e a conexão do <strong>Revolut</strong> (OAuth) ficam <strong>em cada conta</strong> na tela <a className="underline" href="/accounts">Accounts</a>.
        </p>
      </div>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      {companies.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          Crie empresas primeiro em <a className="underline" href="/companies">Companies</a>.
        </p>
      )}

      {companies.map((co) => (
        <section key={co.id} className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
          <h2 className="font-medium">{co.name}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {ISSUERS.map((iss) => {
              const existing = credFor(iss.id, co.name);
              const k = `${iss.id}:${co.name}`;
              return (
                <div key={iss.id} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">{iss.label}</label>
                  {existing?.hasToken && (
                    <div className="flex items-center gap-2 text-xs text-emerald-700">
                      ✓ {existing.tokenMasked}
                      <button className="text-red-600 hover:underline" onClick={() => del(existing.id)}>remover</button>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <input
                      className={input + " flex-1"}
                      placeholder={existing?.hasToken ? "trocar token…" : "token"}
                      type="password"
                      value={draft[k] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                    />
                    <button className={btn} onClick={() => save(iss.id, co.name)}>Salvar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
