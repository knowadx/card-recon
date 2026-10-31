"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Controle de importação — por conta e mês, dois checkpoints SEPARADOS e só calculados (decisão do
 * dono em 2026-10-30): 1) o mês foi importado por inteiro? (cobertura, não contagem de lançamentos)
 * 2) está categorizado? Clique numa célula pra ver quais importações cobrem aquele mês.
 */

type EstadoImp = "completo" | "parcial" | "sem_comprovacao" | "faltando" | "antes";
type Mes = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number };
type Conta = {
  id: string; name: string; bank: string; companyId: string; fonte: string | null; nuncaImportada: boolean; cobertaAte: string | null;
  ultimaImportacao: { quando: string; quem: string | null; fonte: string; arquivo: string | null } | null;
  meses: Record<string, Mes>;
};
type Dados = { months: string[]; companies: Array<{ id: string; name: string; color: string }>; accounts: Conta[] };
type Importacao = { de: string; ate: string; fonte: string; quando: string; quem: string | null; arquivo: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** Último dia coberto de um trecho (o fim é exclusivo). */
const ultimoDia = (ateIso: string) => br(new Date(new Date(ateIso).getTime() - 1).toISOString());
const diaDoMes = (iso: string) => String(new Date(iso).getUTCDate());

function textoParcial(m: Mes) {
  const p = m.pedacos ?? [];
  if (p.length !== 1) return "parcial";
  const de = new Date(p[0].de);
  const fimDia = new Date(new Date(p[0].ate).getTime() - 1);
  return de.getUTCDate() === 1 ? `até ${fimDia.getUTCDate()}` : `desde ${diaDoMes(p[0].de)}`;
}

function CelulaImp({ m }: { m: Mes }) {
  switch (m.imp) {
    case "completo": return <span className="text-[13px] font-bold text-emerald-600">✓</span>;
    case "parcial": return <span className="text-[10.5px] font-semibold text-amber-600 whitespace-nowrap">{textoParcial(m)}</span>;
    case "sem_comprovacao": return <span className="text-[12px] font-bold text-amber-500">?</span>;
    case "faltando": return <span className="text-[12px] font-bold text-red-500">✕</span>;
    default: return <span className="text-[#e5e7eb]">·</span>;
  }
}

function CelulaCat({ total, semCategoria }: { total: number; semCategoria: number }) {
  if (total === 0) return <span className="text-[10px] text-transparent">.</span>;
  const pct = Math.floor(((total - semCategoria) / total) * 100);
  return <span className={`text-[10px] tabular-nums ${semCategoria === 0 ? "text-emerald-600" : pct >= 75 ? "text-amber-600" : "text-red-500"}`}>{semCategoria === 0 ? "100%" : `${pct}%`}</span>;
}

function dicaImp(m: Mes) {
  switch (m.imp) {
    case "completo": return "importado por inteiro";
    case "parcial": return `importado só em parte: ${(m.pedacos ?? []).map((p) => `${br(p.de)}–${ultimoDia(p.ate)}`).join(", ")}`;
    case "sem_comprovacao": return `${m.total} lançamento(s), mas nenhuma importação registrada cobre o mês`;
    case "faltando": return "nada importado neste mês";
    default: return "a conta ainda não tinha dados";
  }
}

export default function ControlPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [detalhe, setDetalhe] = useState<{ conta: Conta; mes: string; importacoes: Importacao[] | null } | null>(null);
  const [desde, setDesde] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  // abre já nos meses mais recentes (à direita) — em tela estreita os antigos ficam pra rolar
  const tabelaRef = useRef<HTMLDivElement>(null);
  const rolou = useRef(false);
  useEffect(() => {
    if (dados && tabelaRef.current && !rolou.current) {
      tabelaRef.current.scrollLeft = tabelaRef.current.scrollWidth;
      rolou.current = true;
    }
  }, [dados]);

  const aplicar = useCallback((ok: boolean, d: Dados & { error?: string }) => {
    if (!ok) { setErro(d.error ?? "erro ao carregar"); return; }
    setDados(d);
    setAberto((prev) => (Object.keys(prev).length ? prev : Object.fromEntries(d.companies.map((c) => [c.id, true]))));
    setDesde((prev) => prev || d.months[d.months.length - 7]);
  }, []);
  const buscar = () => fetch("/api/coverage").then((r) => r.json().then((d) => ({ ok: r.ok, d })));
  const carregar = () => buscar().then(({ ok, d }) => aplicar(ok, d));
  useEffect(() => {
    let vivo = true;
    buscar().then(({ ok, d }) => { if (vivo) aplicar(ok, d); });
    return () => { vivo = false; };
  }, [aplicar]);

  async function abrirDetalhe(conta: Conta, mes: string) {
    setDetalhe({ conta, mes, importacoes: null });
    const r = await fetch(`/api/coverage/detalhe?accountId=${conta.id}&mes=${mes}`).then((x) => x.json()).catch(() => ({ importacoes: [] }));
    setDetalhe({ conta, mes, importacoes: r.importacoes ?? [] });
  }

  async function sincronizar() {
    if (!desde) return;
    setSincronizando(true);
    setResultadoSync(null);
    const r = await fetch("/api/sync/all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `${desde}-01` }) })
      .then((x) => x.json()).catch(() => ({ error: "falhou" }));
    setSincronizando(false);
    if (r.error) setResultadoSync(`❌ ${r.error}`);
    else {
      const erros = (r.accounts ?? []).filter((a: { error?: string }) => a.error);
      setResultadoSync(`✅ ${r.imported} lançamento(s) novo(s) em ${(r.accounts ?? []).length} conta(s)${erros.length ? ` · ⚠️ ${erros.length} com erro: ${erros.map((a: { accountName: string; error: string }) => `${a.accountName} (${a.error})`).join("; ")}` : ""}`);
    }
    carregar();
  }

  if (erro) return <div className="p-8 text-[13px] text-[#6b7280]">{erro}</div>;
  if (!dados) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8fafc]">
        <div className="w-5 h-5 border-2 border-[#00b9a5] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const atual = new Date().toISOString().slice(0, 7);
  const input = "h-8 rounded-lg border border-[#e8eaed] px-2 text-[13px]";
  const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50";

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Controle de importação</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Por conta e mês: <strong>importado por inteiro?</strong> (em cima) e <strong>categorizado?</strong> (embaixo). Clique numa célula pra ver o que foi importado.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#6b7280]">Sincronizar contas com API desde</span>
          <input type="month" className={input} value={desde} onChange={(e) => setDesde(e.target.value)} />
          <button className={btn} onClick={sincronizar} disabled={sincronizando || !desde}>{sincronizando ? "Sincronizando…" : "Sincronizar"}</button>
        </div>
      </div>
      {resultadoSync && <div className="px-8 py-2 text-[12.5px] bg-white border-b border-[#e8eaed] text-[#374151]">{resultadoSync}</div>}

      <div className="flex-1 overflow-auto p-8">
        <div ref={tabelaRef} className="bg-white rounded-2xl border border-[#e8eaed] overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#f3f4f6]">
                <th className="text-left px-6 py-4 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider sticky left-0 bg-white min-w-[300px] z-10">Empresa / conta</th>
                {dados.months.map((m) => (
                  <th key={m} className={`px-1 py-4 text-center min-w-[52px] ${m === atual ? "bg-[#f0fdf9]" : ""}`}>
                    <div className={`text-[12px] font-semibold ${m === atual ? "text-[#00b9a5]" : "text-[#9ca3af]"}`}>{MESES[+m.slice(5, 7) - 1]}</div>
                    <div className="text-[10px] text-[#d1d5db] mt-0.5">{m.slice(0, 4)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.companies.map((empresa) => {
                const contas = dados.accounts.filter((a) => a.companyId === empresa.id);
                return (
                  <React.Fragment key={empresa.id}>
                    <tr className="border-b border-[#e8eaed] bg-[#fafbfc] cursor-pointer hover:bg-[#f3f4f6]" onClick={() => setAberto((p) => ({ ...p, [empresa.id]: !p[empresa.id] }))}>
                      <td className="px-6 py-3 sticky left-0 bg-[#fafbfc] z-10">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[#9ca3af] text-[11px] font-mono w-3 select-none">{aberto[empresa.id] ? "▾" : "▸"}</span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: empresa.color }} />
                          <span className="text-[13.5px] font-semibold text-[#374151]">{empresa.name}</span>
                          <span className="text-[11px] text-[#9ca3af]">{contas.length} conta{contas.length !== 1 ? "s" : ""}</span>
                        </div>
                      </td>
                      {dados.months.map((m, i) => {
                        // conta nunca importada conta como faltando — esconder deixaria uma conta esquecida sumir —
                        // mas só a partir do 1º mês em que a empresa teve algum dado (antes disso não havia o que importar)
                        const empresaJaTinhaDado = dados.months.slice(0, i + 1).some((mm) => contas.some((c) => !c.nuncaImportada && c.meses[mm].imp !== "antes"));
                        const emUso = contas.filter((c) => (c.nuncaImportada && empresaJaTinhaDado) || (!c.nuncaImportada && c.meses[m].imp !== "antes"));
                        const completas = emUso.filter((c) => c.meses[m].imp === "completo").length;
                        const total = contas.reduce((s, c) => s + c.meses[m].total, 0);
                        const sem = contas.reduce((s, c) => s + c.meses[m].semCategoria, 0);
                        return (
                          <td key={m} className={`px-1 py-2 text-center ${m === atual ? "bg-[#f0fdf9]" : ""}`} title={emUso.length ? `${completas} de ${emUso.length} conta(s) importadas por inteiro` : ""}>
                            <div className="flex flex-col items-center gap-0.5 leading-none">
                              {emUso.length === 0 ? <span className="text-[#e5e7eb]">·</span>
                                : completas === emUso.length ? <span className="text-[13px] font-bold text-emerald-600">✓</span>
                                : <span className="text-[10.5px] font-semibold text-amber-600 tabular-nums">{completas}/{emUso.length}</span>}
                              <CelulaCat total={total} semCategoria={sem} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {aberto[empresa.id] && contas.map((c) => (
                      <tr key={c.id} className="border-b border-[#f3f4f6] hover:bg-[#fafbfc]">
                        <td className="sticky left-0 bg-white z-10">
                          <div className="pl-10 pr-6 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] text-[#374151] font-medium">{c.name}</span>
                              <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-full bg-[#f3f4f6] text-[#6b7280]">{c.bank}</span>
                              {c.fonte && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-full bg-[#e6f7f5] text-[#007a6e]">{c.fonte === "ofx" ? "OFX" : "API"}</span>}
                            </div>
                            <div className="text-[11px] mt-0.5">
                              {c.nuncaImportada ? <span className="text-red-500">nunca importada</span>
                                : <span className="text-[#9ca3af]">
                                    {c.cobertaAte ? `importada até ${br(c.cobertaAte)}` : "nenhuma importação registrada"}
                                    {c.ultimaImportacao && ` · última em ${br(c.ultimaImportacao.quando)}${c.ultimaImportacao.quem ? ` por ${c.ultimaImportacao.quem}` : ""}`}
                                  </span>}
                            </div>
                          </div>
                        </td>
                        {c.nuncaImportada
                          ? <td colSpan={dados.months.length} className="text-[12px] text-red-400 px-4">nenhum dado importado nesta conta — importe ou apague a conta se ela não é usada</td>
                          : dados.months.map((m) => {
                            const mes = c.meses[m];
                            return (
                              <td key={m} className={`px-1 py-2 text-center ${m === atual ? "bg-[#f0fdf9]" : ""} ${mes.imp !== "antes" ? "cursor-pointer hover:bg-[#f3f4f6]" : ""}`}
                                title={`${dicaImp(mes)}${mes.total ? ` · ${mes.total} lançamento(s), ${mes.semCategoria} sem categoria` : ""}`}
                                onClick={() => mes.imp !== "antes" && abrirDetalhe(c, m)}>
                                <div className="flex flex-col items-center gap-0.5 leading-none">
                                  <CelulaImp m={mes} />
                                  <CelulaCat total={mes.total} semCategoria={mes.semCategoria} />
                                </div>
                              </td>
                            );
                          })}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 px-1 text-[12px] text-[#6b7280]">
          <span><b className="text-emerald-600">✓</b> mês importado por inteiro</span>
          <span><b className="text-amber-600">até 16</b> importado só até o dia 16</span>
          <span><b className="text-amber-500">?</b> tem lançamentos, mas nenhuma importação registrada cobre o mês</span>
          <span><b className="text-red-500">✕</b> nada importado</span>
          <span><b className="text-emerald-600">100%</b> / <b className="text-amber-600">62%</b> lançamentos do mês com categoria</span>
          <span><b>2/3</b> na empresa = contas importadas por inteiro</span>
        </div>
      </div>

      {detalhe && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4" onClick={() => setDetalhe(null)}>
          <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-xl max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-bold text-[#1a202c]">{detalhe.conta.name}</h2>
                <p className="text-[12px] text-[#6b7280]">{MESES[+detalhe.mes.slice(5, 7) - 1]}/{detalhe.mes.slice(0, 4)} · {dicaImp(detalhe.conta.meses[detalhe.mes])}</p>
              </div>
              <button className="text-[#9ca3af] hover:text-[#374151]" onClick={() => setDetalhe(null)}>✕</button>
            </div>
            <p className="text-[13px] text-[#374151]">
              {detalhe.conta.meses[detalhe.mes].total} lançamento(s) no mês · {detalhe.conta.meses[detalhe.mes].semCategoria} sem categoria
            </p>
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[#9ca3af] mb-1">Importações que cobrem o mês</h3>
              {!detalhe.importacoes ? <p className="text-[12px] text-[#9ca3af]">carregando…</p>
                : detalhe.importacoes.length === 0 ? <p className="text-[12px] text-[#6b7280]">Nenhuma. {detalhe.conta.fonte === "ofx" || !detalhe.conta.fonte ? "Importe o OFX do período em Contas." : "Sincronize desde este mês (botão no topo)."}</p>
                : (
                  <ul className="divide-y divide-[#f3f4f6] text-[12.5px]">
                    {detalhe.importacoes.map((i, k) => (
                      <li key={k} className="py-1.5">
                        <span className="font-medium text-[#374151]">{i.fonte === "ofx" ? "OFX" : "Sync da API"}</span>
                        <span className="text-[#6b7280]"> · cobre {br(i.de)} a {ultimoDia(i.ate)}</span>
                        <div className="text-[11.5px] text-[#9ca3af]">em {br(i.quando)} {new Date(i.quando).toISOString().slice(11, 16)} UTC{i.quem ? ` por ${i.quem}` : ""}{i.arquivo ? ` · ${i.arquivo}` : ""}</div>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
