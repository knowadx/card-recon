"use client";

import React, { useCallback, useEffect, useState } from "react";
import { resumoDoMes as resumoDaEmpresa, type EstadoImp } from "@/lib/mesFechado";

/**
 * Controle de importação — MÊS A MÊS num quadro só (escolha do dono em 2026-11-12, sobre a proposta A:
 * "assim ficou melhor"; antes: grade com ícones "poluída" e linha do tempo "não dá pra saber o que foi
 * importado, se o mês tá fechado, quantas categorizações estão pendentes"). Faixa de meses no topo, os
 * números do mês escolhido e uma linha por empresa, em palavras e números:
 *  - importação: quantas contas da empresa foram importadas do 1º ao último dia do mês;
 *  - categorização: quantos lançamentos do mês estão sem categoria;
 *  - FECHADO = as duas coisas completas (todas as contas importadas E nada sem categoria).
 * A empresa abre conta a conta; clique numa conta mostra quais importações cobrem o mês.
 */

type Mes = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number };
type Conta = {
  id: string; name: string; bank: string; companyId: string; fonte: string | null; nuncaImportada: boolean; cobertaAte: string | null;
  ultimaImportacao: { quando: string; quem: string | null; fonte: string; arquivo: string | null } | null;
  meses: Record<string, Mes>;
};
type Dados = { months: string[]; companies: Array<{ id: string; name: string; color: string }>; accounts: Conta[] };
type Importacao = { de: string; ate: string; fonte: string; quando: string; quem: string | null; arquivo: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** Último dia coberto de um trecho (o fim é exclusivo). */
const ultimoDia = (ateIso: string) => br(new Date(new Date(ateIso).getTime() - 1).toISOString());
const n = (x: number) => x.toLocaleString("pt-BR");

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
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [vaziasAbertas, setVaziasAbertas] = useState(false);
  const [detalhe, setDetalhe] = useState<{ conta: Conta; mes: string; importacoes: Importacao[] | null } | null>(null);
  const [desde, setDesde] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);

  const aplicar = useCallback((ok: boolean, d: Dados & { error?: string }) => {
    if (!ok) { setErro(d.error ?? "erro ao carregar"); return; }
    setDados(d);
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

  const meses = dados.months;
  const atual = meses[meses.length - 1];
  // empresas com algum dado; as contas sem nenhum dado de empresas sem dado vão pra linha recolhida no fim
  const empresas = dados.companies
    .map((e) => ({ ...e, contas: dados.accounts.filter((c) => c.companyId === e.id) }))
    .filter((e) => e.contas.some((c) => !c.nuncaImportada));
  const vazias = dados.accounts.filter((c) => c.nuncaImportada && !empresas.some((e) => e.id === c.companyId));
  const nomeEmpresa = (id: string) => dados.companies.find((e) => e.id === id)?.name ?? "";
  const resumoDoMes = (m: string) => empresas
    .map((e) => ({ empresa: e, r: resumoDaEmpresa(e.contas, meses, m) }))
    .filter(({ r }) => !r.vazio || r.total > 0);
  // meses na faixa: do 1º com alguma empresa ativa até o atual
  const primeiro = meses.findIndex((m) => resumoDoMes(m).length > 0);
  const faixa = primeiro < 0 ? [atual] : meses.slice(primeiro);
  // padrão: o último mês que já acabou
  const mes = mesEscolhido && faixa.includes(mesEscolhido) ? mesEscolhido : faixa.length > 1 ? faixa[faixa.length - 2] : atual;
  const nomeMes = `${MESES_LONGOS[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
  const linhas = resumoDoMes(mes).sort((a, b) => Number(a.r.fechado) - Number(b.r.fechado) || b.r.pend - a.r.pend || a.empresa.name.localeCompare(b.empresa.name));
  const fechadas = linhas.filter((l) => l.r.fechado).length;
  const contasNoMes = linhas.reduce((s, l) => s + l.r.contas, 0);
  const importadasNoMes = linhas.reduce((s, l) => s + l.r.importadas, 0);
  const pendNoMes = linhas.reduce((s, l) => s + l.r.pend, 0);
  const abreviado = MESES[+mes.slice(5, 7) - 1].toLowerCase();

  const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50";
  const grade = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_90px] items-center gap-3";
  const selo = (fechado: boolean) => fechado
    ? <span className="rounded-md bg-emerald-50 text-emerald-700 font-medium px-2.5 py-0.5 text-[12px]">Fechado</span>
    : <span className="rounded-md bg-amber-50 text-amber-700 font-medium px-2.5 py-0.5 text-[12px]">Aberto</span>;

  /** O que dizer da importação de UMA conta no mês selecionado. */
  const linhaDaConta = (c: Conta): { texto: string; cor: string } => {
    if (c.nuncaImportada) return { texto: "nunca importada — importe em Contas (ou apague a conta, se não é usada)", cor: "text-red-500" };
    const m = c.meses[mes];
    if (m.imp === "completo") return { texto: "importado", cor: "text-emerald-600" };
    if (m.imp === "parcial") return { texto: `importado só ${(m.pedacos ?? []).map((p) => `de ${br(p.de).slice(0, 5)} a ${ultimoDia(p.ate).slice(0, 5)}`).join(", ")}`, cor: "text-amber-600" };
    if (m.imp === "antes") return { texto: "ainda sem dados neste mês", cor: "text-[#9ca3af]" };
    return { texto: c.fonte === "ofx" || !c.fonte ? `não importado — importe o OFX de ${abreviado}` : `não importado — sincronizar desde ${abreviado}`, cor: "text-red-500" };
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Controle de importação</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Escolha o mês: o que já foi importado, o que falta categorizar e se o mês está fechado.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#6b7280]">Sincronizar APIs desde</span>
          <input type="month" className="h-8 rounded-lg border border-[#e8eaed] px-2 text-[13px]" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <button className={btn} onClick={sincronizar} disabled={sincronizando || !desde}>{sincronizando ? "Sincronizando…" : "Sincronizar"}</button>
        </div>
      </div>
      {resultadoSync && <div className="px-8 py-2 text-[12.5px] bg-white border-b border-[#e8eaed] text-[#374151]">{resultadoSync}</div>}

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-5xl space-y-4">
          {/* faixa dos meses */}
          <div className="flex flex-wrap gap-2">
            {faixa.map((m) => {
              const rs = resumoDoMes(m);
              const f = rs.filter(({ r }) => r.fechado).length;
              const ativo = m === mes;
              return (
                <button key={m} onClick={() => setMesEscolhido(m)}
                  className={`text-left rounded-lg bg-white px-3 py-2 text-[12.5px] ${ativo ? "border-2 border-[#00b9a5]" : "border border-[#e8eaed] hover:border-[#cbd5e1]"}`}>
                  <div className={`font-medium ${ativo ? "text-[#1a202c]" : "text-[#4b5563]"}`}>{MESES[+m.slice(5, 7) - 1]}<span className="text-[#c4c9d0] font-normal"> {m.slice(2, 4)}</span></div>
                  {m === atual ? <div className="text-[#9ca3af]">em andamento</div>
                    : rs.length === 0 ? <div className="text-[#d1d5db]">sem dados</div>
                    : <div className={f === rs.length ? "text-emerald-600" : "text-amber-700"}>{f}/{rs.length} fechadas</div>}
                </button>
              );
            })}
          </div>

          {/* números do mês */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Empresas fechadas", `${fechadas} de ${linhas.length}`],
              ["Contas importadas", `${importadasNoMes} de ${contasNoMes}`],
              ["Sem categoria", n(pendNoMes)],
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="rounded-xl bg-white border border-[#e8eaed] px-4 py-3">
                <div className="text-[12.5px] text-[#6b7280]">{rotulo}</div>
                <div className="text-[24px] font-semibold text-[#1a202c] tabular-nums">{valor}</div>
              </div>
            ))}
          </div>

          {/* empresas do mês */}
          <div className="rounded-2xl bg-white border border-[#e8eaed] overflow-hidden text-[13px]">
            <div className={`${grade} px-5 py-2.5 border-b border-[#f3f4f6] text-[12px] text-[#9ca3af]`}>
              <span>{nomeMes}{mes === atual ? " · em andamento" : ""}</span><span>Importação</span><span>Categorização</span><span className="text-right">Mês</span>
            </div>
            {linhas.length === 0 && <div className="px-5 py-4 text-[#9ca3af]">Nenhuma empresa com dados neste mês.</div>}
            {linhas.map(({ empresa: e, r }) => {
              const aberta = !!abertas[e.id];
              return (
                <div key={e.id} className="border-b border-[#f3f4f6] last:border-b-0">
                  <button className={`${grade} w-full px-5 py-2.5 text-left hover:bg-[#fafbfc]`} onClick={() => setAbertas((p) => ({ ...p, [e.id]: !p[e.id] }))}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[#9ca3af] text-[10px] w-3 shrink-0">{aberta ? "▾" : "▸"}</span>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
                      <span className="font-medium text-[#374151] truncate">{e.name}</span>
                    </span>
                    <span className={r.importadas === r.contas ? "text-emerald-600" : r.importadas === 0 ? "text-red-500" : "text-amber-700"}>
                      {r.importadas === r.contas ? "✓ " : ""}{r.importadas} de {r.contas} conta{r.contas !== 1 ? "s" : ""}
                    </span>
                    <span className={r.pend === 0 ? (r.total ? "text-emerald-600" : "text-[#9ca3af]") : r.importadas === r.contas ? "text-amber-700" : "text-red-500"}>
                      {r.pend === 0 ? (r.total ? "✓ tudo categorizado" : "sem lançamentos") : `${n(r.pend)} pendente${r.pend !== 1 ? "s" : ""}`}
                    </span>
                    <span className="text-right">{selo(r.fechado)}</span>
                  </button>
                  {aberta && (
                    <div className="pb-2">
                      {e.contas.map((c) => {
                        const l = linhaDaConta(c);
                        const m = c.nuncaImportada ? null : c.meses[mes];
                        return (
                          <div key={c.id} className={`${grade} px-5 py-1.5 text-[12.5px] ${m && m.imp !== "antes" ? "cursor-pointer hover:bg-[#fafbfc]" : ""}`}
                            onClick={() => m && m.imp !== "antes" && abrirDetalhe(c, mes)}
                            title={`${c.cobertaAte ? `importada até ${br(c.cobertaAte)}` : "nenhuma importação registrada"}${c.ultimaImportacao ? ` · última em ${br(c.ultimaImportacao.quando)}${c.ultimaImportacao.quem ? ` por ${c.ultimaImportacao.quem}` : ""}` : ""}`}>
                            <span className="pl-8 text-[#4b5563] truncate">{c.name} <span className="text-[#9ca3af]">· {c.fonte === "ofx" ? "OFX" : c.fonte === "api" ? "API" : c.bank}</span></span>
                            <span className={`${l.cor} ${c.nuncaImportada ? "col-span-3" : ""}`}>{l.texto}</span>
                            {!c.nuncaImportada && <span className="text-[#6b7280]">{m && m.semCategoria > 0 ? `${n(m.semCategoria)} pendente${m.semCategoria !== 1 ? "s" : ""}` : ""}</span>}
                            {!c.nuncaImportada && <span />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[12px] text-[#6b7280]">Mês <strong className="text-emerald-700">fechado</strong> = todas as contas importadas do dia 1 ao último dia e nenhum lançamento sem categoria. Clique na empresa pra ver conta a conta; clique numa conta pra ver quais importações cobrem o mês.</p>

          {vazias.length > 0 && (
            <div>
              <button className="text-[12.5px] text-[#6b7280] hover:text-[#374151]" onClick={() => setVaziasAbertas((v) => !v)}>
                {vaziasAbertas ? "▾" : "▸"} {vazias.length} conta{vazias.length !== 1 ? "s" : ""} de empresas sem nenhum dado
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
