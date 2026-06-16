"use client";

import { useEffect, useState } from "react";

interface Cred {
  id: string;
  issuer: string;
  company: string;
  isActive: boolean;
  tokenMasked: string;
  hasToken: boolean;
}

export default function SettingsPage() {
  const [tol, setTol] = useState("2");
  const [pattern, setPattern] = useState("");
  const [creds, setCreds] = useState<Cred[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // form nova credencial (mercury/wise)
  const [issuer, setIssuer] = useState("mercury");
  const [company, setCompany] = useState("");
  const [token, setToken] = useState("");

  // form revolut
  const [revCompany, setRevCompany] = useState("");
  const [revClientId, setRevClientId] = useState("");

  async function load() {
    const [s, c] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/credentials").then((r) => r.json()),
    ]);
    setTol(String(parseFloat(s.tolerancePct) * 100));
    setPattern(s.metaMerchantPattern);
    setCreds(c);
  }
  useEffect(() => {
    load();
  }, []);

  async function saveSettings() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tolerancePct: parseFloat(tol) / 100, metaMerchantPattern: pattern }),
    });
    setMsg("✅ Configurações salvas");
  }

  async function addCred() {
    if (!company || !token) {
      setMsg("❌ empresa e token obrigatórios");
      return;
    }
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuer, company, token }),
    });
    const j = await res.json();
    setMsg(j.ok ? `✅ ${issuer}/${company} salvo` : `❌ ${j.error}`);
    setCompany("");
    setToken("");
    load();
  }

  async function delCred(id: string) {
    await fetch(`/api/credentials?id=${id}`, { method: "DELETE" });
    load();
  }

  const box = "rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3";
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Configurações</h1>
      {msg && <div className="rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-100">{msg}</div>}

      <section className={box}>
        <h2 className="font-medium">Conciliação</h2>
        <label className="flex items-center gap-2 text-sm">
          Tolerância de divergência (%)
          <input className={input + " w-24"} type="number" step="0.5" value={tol} onChange={(e) => setTol(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Regex de merchant “Meta” (classifica cobranças)
          <input className={input} value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        <button className={btn + " self-start"} onClick={saveSettings}>Salvar</button>
      </section>

      <section className={box}>
        <h2 className="font-medium">Credenciais por empresa (Mercury / Wise)</h2>
        <p className="text-xs text-slate-500">Mercury: 1 token por empresa. Wise: token (bearer). Cada um vira uma empresa na conciliação.</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={input} value={issuer} onChange={(e) => setIssuer(e.target.value)}>
            <option value="mercury">mercury</option>
            <option value="wise">wise</option>
          </select>
          <input className={input} placeholder="Empresa" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className={input + " flex-1 min-w-[240px]"} placeholder="Token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className={btn} onClick={addCred}>Adicionar</button>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-medium">Revolut (OAuth por empresa)</h2>
        <p className="text-xs text-slate-500">
          1) Suba o certificado <code>revolut_public.cer</code> em cada empresa no Revolut e pegue o Client ID. 2) Preencha abaixo e clique
          “Consentir” — abre o Revolut, autoriza, e volta. Precisa de redirect HTTPS em produção.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <input className={input} placeholder="Empresa" value={revCompany} onChange={(e) => setRevCompany(e.target.value)} />
          <input className={input + " flex-1 min-w-[240px]"} placeholder="Client ID" value={revClientId} onChange={(e) => setRevClientId(e.target.value)} />
          <a
            className={btn + (revCompany && revClientId ? "" : " pointer-events-none opacity-50")}
            href={`/api/revolut/auth?company=${encodeURIComponent(revCompany)}&client_id=${encodeURIComponent(revClientId)}`}
          >
            Consentir
          </a>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-medium">Credenciais cadastradas ({creds.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Banco</th>
              <th className="py-1">Empresa</th>
              <th className="py-1">Token</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {creds.map((c) => (
              <tr key={c.id}>
                <td className="py-1">{c.issuer}</td>
                <td className="py-1">{c.company}</td>
                <td className="py-1 text-xs text-slate-500">{c.issuer === "revolut" ? (c.hasToken ? "consentido ✓" : "sem consentimento") : c.tokenMasked}</td>
                <td className="py-1 text-right">
                  <button className="text-xs text-red-600 hover:underline" onClick={() => delCred(c.id)}>remover</button>
                </td>
              </tr>
            ))}
            {creds.length === 0 && (
              <tr><td colSpan={4} className="py-2 text-slate-400">nenhuma — usando tokens do .env como fallback</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
