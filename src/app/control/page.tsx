"use client";

import React, { useCallback, useEffect, useState } from "react";

/**
 * Controle de importação — dois checkpoints SEPARADOS e só calculados (decisão do dono em 2026-10-30),
 * um por aba (2026-11-09: "a guia ficou muito poluída"):
 *  - Importação: linha do tempo por conta — verde onde a importação cobriu, listrado onde há lançamento
 *    sem importação registrada, vazio onde falta. Clique num mês pra ver quais importações o cobrem.
 *  - Categorização: % dos lançamentos do mês com categoria gerencial.
 * Empresas sem dado somem; contas sem nenhum dado ficam numa linha recolhida no fim.
 */

type EstadoImp = "completo" | "parcial" | "sem_comprovacao" | "faltando" | "antes";
type Mes = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number };
type Conta = {
  id: string; name: string; bank: string; companyId: string; fonte: string | null; nuncaImportada: boolean; cobertaAte: string | null;
  ultimaImportacao: { quando: string; quem: string | null; fonte: string; arquivo: string | null } | null;
  trechos: Array<{ de: string; ate: string }>;
  meses: Record<string, Mes>;
};
type Dados = { months: string[]; companies: Array<{ id: string; name: string; color: string }>; accounts: Conta[] };
type Importacao = { de: string; ate: string; fonte: string; quando: string; quem: string | null; arquivo: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** Último dia coberto de um trecho (o fim é exclusivo). */
const ultimoDia = (ateIso: string) => br(new Date(new Date(ateIso).getTime() - 1).toISOString());
const inicioMes = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
const fimMes = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1);
const LISTRADO = "repeating-linear-gradient(135deg, #fcd34d 0 3px, #fef3c7 3px 6px)";

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
  const [aba, setAba] = useState<"importacao" | "categorizacao">("importacao");
  const [recolhidas, setRecolhidas] = useState<Record<string, boolean>>({});
  const [vaziasAbertas, setVaziasAbertas] = useState(false);
  const [detalhe, setDetalhe] = useState<{ conta: Conta; mes: string; importacoes: Importacao[] | null } | null>(null);
  const [desde, setDesde] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  const [agora, setAgora] = useState(0); // "hoje" da linha do tempo — lido ao carregar (render não lê relógio)

  const aplicar = useCallback((ok: boolean, d: Dados & { error?: string }) => {
    if (!ok) { setErro(d.error ?? "erro ao carregar"); return; }
    setDados(d);
    setAgora(Date.now());
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
      .then((x) => x.json()).catch(() => ({ error: "falhou (a tela desistiu de esperar — recarregue daqui a pouco pra ver o que entrou)" }));
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

  // janela da linha do tempo: do 1º dia do mês mais antigo ao fim do mês atual
  const ini = inicioMes(dados.months[0]);
  const fim = fimMes(dados.months[dados.months.length - 1]);
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - ini) / (fim - ini)) * 100));
  const hoje = pos(agora);

  const comDado = dados.accounts.filter((c) => !c.nuncaImportada);
  const vazias = dados.accounts.filter((c) => c.nuncaImportada);
  const nomeEmpresa = (id: string) => dados.companies.find((e) => e.id === id)?.name ?? "";
  const empresas = dados.companies
    .map((e) => ({ ...e, contas: comDado.filter((c) => c.companyId === e.id && (aba === "importacao" || dados.months.some((m) => c.meses[m].total > 0))) }))
    .filter((e) => e.contas.length > 0);

  const colunas = "grid grid-cols-[minmax(150px,260px)_1fr] items-center";
  const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50";

  const trilha = (c: Conta) => {
    const comeco = dados!.months.find((m) => c.meses[m].imp !== "antes");
    const desdeDado = comeco ? pos(inicioMes(comeco)) : 100;
    return (
      <div
        className="relative h-6 cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = ini + ((e.clientX - r.left) / r.width) * (fim - ini);
          const mes = dados!.months.find((m) => t >= inicioMes(m) && t < fimMes(m));
          if (mes && c.meses[mes].imp !== "antes") abrirDetalhe(c, mes);
        }}
      >
        {/* trilho (o que falta) do 1º dado da conta até hoje — dia que ainda não aconteceu não "falta" */}
        {hoje > desdeDado && <div className="absolute top-2 h-2 rounded-full bg-[#e5e7eb]" style={{ left: `${desdeDado}%`, width: `${hoje - desdeDado}%` }} />}
        {/* meses com lançamento mas sem importação registrada */}
        {dados!.months.filter((m) => c.meses[m].imp === "sem_comprovacao").map((m) => (
          <div key={m} className="absolute top-2 h-2" style={{ left: `${pos(inicioMes(m))}%`, width: `${Math.min(pos(fimMes(m)), hoje) - pos(inicioMes(m))}%`, background: LISTRADO }}
            title={`${MESES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}: ${dicaImp(c.meses[m])}`} />
        ))}
        {/* o que foi importado */}
        {c.trechos.map((t, i) => (
          <div key={i} className="absolute top-2 h-2 rounded-full bg-emerald-500" style={{ left: `${pos(Date.parse(t.de))}%`, width: `${pos(Date.parse(t.ate)) - pos(Date.parse(t.de))}%` }}
            title={`importado de ${br(t.de)} a ${ultimoDia(t.ate)}`} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Controle de importação</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">{aba === "importacao" ? "O que já foi importado de cada conta. Clique num mês pra ver de onde veio." : "Quanto de cada mês já tem categoria."}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-[#e8eaed] bg-[#f8fafc] p-0.5 text-[13px]">
            {([["importacao", "Importação"], ["categorizacao", "Categorização"]] as const).map(([k, rotulo]) => (
              <button key={k} onClick={() => setAba(k)} className={`px-3 h-7 rounded-md font-medium ${aba === k ? "bg-white shadow-sm text-[#1a202c]" : "text-[#6b7280]"}`}>{rotulo}</button>
            ))}
          </div>
          {aba === "importacao" && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#6b7280]">Sincronizar APIs desde</span>
              <input type="month" className="h-8 rounded-lg border border-[#e8eaed] px-2 text-[13px]" value={desde} onChange={(e) => setDesde(e.target.value)} />
              <button className={btn} onClick={sincronizar} disabled={sincronizando || !desde}>{sincronizando ? "Sincronizando…" : "Sincronizar"}</button>
            </div>
          )}
        </div>
      </div>
      {resultadoSync && aba === "importacao" && <div className="px-8 py-2 text-[12.5px] bg-white border-b border-[#e8eaed] text-[#374151]">{resultadoSync}</div>}

      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-2xl border border-[#e8eaed] px-5 py-3">
          {/* cabeçalho dos meses */}
          <div className={`${colunas} pb-2 border-b border-[#f3f4f6]`}>
            <div />
            {aba === "importacao" ? (
              <div className="relative h-5">
                {dados.months.map((m) => (
                  <div key={m} className="absolute text-center text-[11px] font-semibold text-[#9ca3af]" style={{ left: `${pos(inicioMes(m))}%`, width: `${pos(fimMes(m)) - pos(inicioMes(m))}%` }}>
                    {MESES[+m.slice(5, 7) - 1]}{m.endsWith("-01") || m === dados.months[0] ? <span className="font-normal text-[#d1d5db]"> {m.slice(2, 4)}</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${dados.months.length}, minmax(0, 1fr))` }}>
                {dados.months.map((m) => (
                  <div key={m} className="text-center text-[11px] font-semibold text-[#9ca3af]">
                    {MESES[+m.slice(5, 7) - 1]}{m.endsWith("-01") || m === dados.months[0] ? <span className="font-normal text-[#d1d5db]"> {m.slice(2, 4)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            {/* divisas dos meses e o "hoje", atrás das linhas */}
            {aba === "importacao" && (
              <div className={`${colunas} absolute inset-0 pointer-events-none`}>
                <div />
                <div className="relative h-full">
                  {dados.months.slice(1).map((m) => <div key={m} className="absolute top-0 bottom-0 w-px bg-[#f3f4f6]" style={{ left: `${pos(inicioMes(m))}%` }} />)}
                  <div className="absolute top-0 bottom-0 w-px bg-[#00b9a5]/40" style={{ left: `${hoje}%` }} title="hoje" />
                </div>
              </div>
            )}

            {empresas.map((e) => (
              <div key={e.id} className="py-1.5">
                <button className="flex items-center gap-2 py-1 text-left" onClick={() => setRecolhidas((p) => ({ ...p, [e.id]: !p[e.id] }))}>
                  <span className="text-[#9ca3af] text-[10px] w-3">{recolhidas[e.id] ? "▸" : "▾"}</span>
                  <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                  <span className="text-[12.5px] font-semibold text-[#374151]">{e.name}</span>
                </button>
                {!recolhidas[e.id] && e.contas.map((c) => (
                  <div key={c.id} className={`${colunas} relative`}>
                    <div className="flex items-center gap-1.5 pl-5 pr-3 min-w-0"
                      title={`${c.bank} · ${c.cobertaAte ? `importada até ${br(c.cobertaAte)}` : "nenhuma importação registrada"}${c.ultimaImportacao ? ` · última em ${br(c.ultimaImportacao.quando)}${c.ultimaImportacao.quem ? ` por ${c.ultimaImportacao.quem}` : ""}` : ""}`}>
                      <span className="text-[12.5px] text-[#374151] truncate">{c.name}</span>
                      {c.fonte && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#f3f4f6] text-[#6b7280]">{c.fonte === "ofx" ? "OFX" : "API"}</span>}
                    </div>
                    {aba === "importacao" ? trilha(c) : (
                      <div className="grid h-6 items-center" style={{ gridTemplateColumns: `repeat(${dados.months.length}, minmax(0, 1fr))` }}>
                        {dados.months.map((m) => {
                          const { total, semCategoria } = c.meses[m];
                          if (!total) return <div key={m} />;
                          const pct = Math.floor(((total - semCategoria) / total) * 100);
                          return (
                            <div key={m} className="text-center" title={`${total} lançamento(s), ${semCategoria} sem categoria`}>
                              <span className={`text-[11px] tabular-nums font-medium ${semCategoria === 0 ? "text-emerald-600" : pct >= 75 ? "text-amber-600" : "text-red-500"}`}>{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {vazias.length > 0 && (
            <div className="border-t border-[#f3f4f6] mt-2 pt-2">
              <button className="text-[12.5px] text-[#6b7280] hover:text-[#374151]" onClick={() => setVaziasAbertas((v) => !v)}>
                {vaziasAbertas ? "▾" : "▸"} {vazias.length} conta{vazias.length !== 1 ? "s" : ""} sem nenhum dado
              </button>
              {vaziasAbertas && (
                <ul className="mt-1 pl-5 text-[12px] text-[#6b7280] space-y-0.5">
                  {vazias.map((c) => <li key={c.id}>{nomeEmpresa(c.companyId)} · {c.name} <span className="text-[#9ca3af]">({c.bank})</span></li>)}
                  <li className="text-[11.5px] text-[#9ca3af] pt-1">Importe em Contas — ou apague a conta, se ela não é usada.</li>
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 px-1 text-[12px] text-[#6b7280]">
          {aba === "importacao" ? (
            <>
              <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-2 rounded-full bg-emerald-500" /> importado</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-2" style={{ background: LISTRADO }} /> tem lançamento, mas nenhuma importação registrada</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-2 rounded-full bg-[#e5e7eb]" /> falta importar</span>
            </>
          ) : (
            <>
              <span><b className="text-emerald-600">100%</b> tudo com categoria</span>
              <span><b className="text-amber-600">75–99%</b></span>
              <span><b className="text-red-500">&lt;75%</b></span>
              <span className="text-[#9ca3af]">mês sem lançamento fica em branco</span>
            </>
          )}
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
                : detalhe.importacoes.length === 0 ? <p className="text-[12px] text-[#6b7280]">Nenhuma. {detalhe.conta.fonte === "ofx" || !detalhe.conta.fonte ? "Importe o OFX do período em Contas." : "Sincronize desde este mês (no topo)."}</p>
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
