"use client";

import React, { useCallback, useEffect, useState } from "react";
import { INICIO_DOS_FECHAMENTOS, resumoDoMes as resumoDaEmpresa } from "@/lib/mesFechado";
import { PainelDaConta, rotuloDaConta, type ContaDoControle } from "@/components/control/PainelDaConta";

/**
 * Controle de importação — MÊS A MÊS num quadro só (escolha do dono em 2026-11-12, sobre a proposta A:
 * "assim ficou melhor"; antes: grade com ícones "poluída" e linha do tempo "não dá pra saber o que foi
 * importado, se o mês tá fechado, quantas categorizações estão pendentes"). Faixa de meses no topo, os
 * números do mês escolhido e uma linha por empresa, em palavras e números:
 *  - importação: quantas contas da empresa foram importadas do 1º ao último dia do mês;
 *  - categorização: quantos lançamentos do mês estão sem categoria;
 *  - FECHADO = as duas coisas completas (todas as contas importadas E nada sem categoria).
 * A empresa abre conta a conta; clique numa conta abre o painel dela (o que cobre o mês + TODAS as opções
 * de importação daquela conta — src/components/control/PainelDaConta.tsx). Meses desde INICIO_DOS_FECHAMENTOS.
 */

type Conta = ContaDoControle;
type Dados = { months: string[]; companies: Array<{ id: string; name: string; color: string }>; accounts: Conta[] };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** Último dia coberto de um trecho (o fim é exclusivo). */
const ultimoDia = (ateIso: string) => br(new Date(new Date(ateIso).getTime() - 1).toISOString());
const n = (x: number) => x.toLocaleString("pt-BR");

export default function ControlPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [vaziasAbertas, setVaziasAbertas] = useState(false);
  const [painelId, setPainelId] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);
  // "Por empresa" (dono, 2026-11-12: "olhar o fechamento de vários meses juntos, pra mesma empresa, sem ficar
  // mudando de mês"): uma empresa, todos os meses dela, um por linha
  const [visao, setVisao] = useState<"mes" | "empresa">("mes");
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [mesesAbertos, setMesesAbertos] = useState<Record<string, boolean>>({});
  const [painelMes, setPainelMes] = useState<string | null>(null);

  const aplicar = useCallback((ok: boolean, d: Dados & { error?: string }) => {
    if (!ok) { setErro(d.error ?? "erro ao carregar"); return; }
    setDados(d);
    setDesde((prev) => prev || INICIO_DOS_FECHAMENTOS);
  }, []);
  const buscar = () => fetch("/api/coverage").then((r) => r.json().then((d) => ({ ok: r.ok, d })));
  const carregar = () => buscar().then(({ ok, d }) => aplicar(ok, d));
  useEffect(() => {
    let vivo = true;
    buscar().then(({ ok, d }) => { if (vivo) aplicar(ok, d); });
    return () => { vivo = false; };
  }, [aplicar]);

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
  // o painel lê a conta dos dados ATUAIS (depois de importar, a tela recarrega e o painel acompanha)
  const contaDoPainel = painelId ? dados.accounts.find((a) => a.id === painelId) ?? null : null;
  const resumoDoMes = (m: string) => empresas
    .map((e) => ({ empresa: e, r: resumoDaEmpresa(e.contas, meses, m) }))
    .filter(({ r }) => !r.vazio || r.total > 0);
  // faixa = todos os meses dos fechamentos (desde INICIO_DOS_FECHAMENTOS), uma linha por ano
  const anos = [...new Set(meses.map((m) => m.slice(0, 4)))];
  // padrão: o último mês que já acabou
  const mes = mesEscolhido && meses.includes(mesEscolhido) ? mesEscolhido : meses.length > 1 ? meses[meses.length - 2] : atual;
  const nomeMes = `${MESES_LONGOS[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
  const linhas = resumoDoMes(mes).sort((a, b) => Number(a.r.fechado) - Number(b.r.fechado) || b.r.pend - a.r.pend || a.empresa.name.localeCompare(b.empresa.name));
  const fechadas = linhas.filter((l) => l.r.fechado).length;
  const contasNoMes = linhas.reduce((s, l) => s + l.r.contas, 0);
  const importadasNoMes = linhas.reduce((s, l) => s + l.r.importadas, 0);
  const pendNoMes = linhas.reduce((s, l) => s + l.r.pend, 0);

  const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50";
  const grade = "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_80px] items-center gap-3";
  const selo = (fechado: boolean) => fechado
    ? <span className="rounded-md bg-emerald-50 text-emerald-700 font-medium px-2.5 py-0.5 text-[12px]">Fechado</span>
    : <span className="rounded-md bg-amber-50 text-amber-700 font-medium px-2.5 py-0.5 text-[12px]">Aberto</span>;

  /** O que dizer da importação de UMA conta num mês (clicar na conta abre o painel pra importar). */
  const linhaDaConta = (c: Conta, mesDaLinha: string): { texto: string; cor: string } => {
    if (c.nuncaImportada) return { texto: "nunca importada — clique pra importar (ou apague a conta em Contas, se não é usada)", cor: "text-red-500" };
    const abreviado = MESES[+mesDaLinha.slice(5, 7) - 1].toLowerCase();
    const m = c.meses[mesDaLinha];
    if (m.imp === "completo") return { texto: m.total ? "importado" : "sem movimentação", cor: "text-emerald-600" };
    if (m.imp === "parcial") return { texto: `importado só ${(m.pedacos ?? []).map((p) => `de ${br(p.de).slice(0, 5)} a ${ultimoDia(p.ate).slice(0, 5)}`).join(", ")}`, cor: "text-amber-600" };
    if (m.imp === "antes") return { texto: "ainda sem dados neste mês", cor: "text-[#9ca3af]" };
    return { texto: `não importado — clique pra importar ${abreviado}`, cor: "text-red-500" };
  };

  /** Importação · Categorização · Comprovantes · selo — a mesma leitura na visão por mês e por empresa. */
  const celulas = (r: ReturnType<typeof resumoDaEmpresa>, emAndamento: boolean) => (
    <>
      <span className={emAndamento ? "text-[#9ca3af]" : r.importadas === r.contas ? "text-emerald-600" : r.importadas === 0 ? "text-red-500" : "text-amber-700"}>
        {emAndamento ? "em andamento" : <>{r.importadas === r.contas ? "✓ " : ""}{r.importadas} de {r.contas} conta{r.contas !== 1 ? "s" : ""}</>}
      </span>
      <span>
        {!r.total ? <span className="text-[#9ca3af]">sem lançamentos</span> : <>
          <span className="text-emerald-700">{n(r.total - r.pend)} categorizado{r.total - r.pend !== 1 ? "s" : ""}</span>
          {r.pend > 0 && <span className={r.importadas === r.contas ? "text-amber-700" : "text-red-500"}> · {n(r.pend)} pendente{r.pend !== 1 ? "s" : ""}</span>}
        </>}
      </span>
      <span className="text-[#4b5563]">{r.total ? `${n(r.comComprovante)} de ${n(r.total)}` : ""}</span>
      <span className="text-right">{emAndamento ? null : selo(r.fechado)}</span>
    </>
  );
  const abrirConta = (c: Conta, mesDaLinha: string) => { setPainelId(c.id); setPainelMes(mesDaLinha); };
  /** As contas da empresa num mês (o que falta em cada uma); clicar abre o painel daquele mês. */
  const contasDoMes = (e: { name: string; contas: Conta[] }, mesDaLinha: string, recuo: string) => (
    <div className="pb-2">
      {e.contas.map((c) => {
        const l = linhaDaConta(c, mesDaLinha);
        const m = c.nuncaImportada ? null : c.meses[mesDaLinha];
        return (
          <div key={c.id} className={`${grade} px-5 py-1.5 text-[12.5px] cursor-pointer hover:bg-[#f3f4f6]`}
            onClick={() => abrirConta(c, mesDaLinha)}
            title={`${c.cobertaAte ? `importada até ${br(c.cobertaAte)}` : "nenhuma importação registrada"}${c.ultimaImportacao ? ` · última em ${br(c.ultimaImportacao.quando)}${c.ultimaImportacao.quem ? ` por ${c.ultimaImportacao.quem}` : ""}` : ""} · clique pra ver e importar`}>
            <span className={`${recuo} truncate`}>{(() => { const r = rotuloDaConta(c, e.name); return <><span className="font-medium text-[#374151]">{r.titulo}</span>{r.detalhe && <span className="text-[#9ca3af]"> · {r.detalhe}</span>}</>; })()}</span>
            <span className={`${l.cor} ${c.nuncaImportada ? "col-span-4" : ""}`}>{l.texto}</span>
            {!c.nuncaImportada && <span className="text-[#6b7280]">{m && m.total ? `${n(m.total - m.semCategoria)} categ.${m.semCategoria ? ` · ${n(m.semCategoria)} pend.` : ""}` : ""}</span>}
            {!c.nuncaImportada && <span className="text-[#6b7280]">{m && m.total ? `${n(m.comComprovante)} de ${n(m.total)}` : ""}</span>}
            {!c.nuncaImportada && <span />}
          </div>
        );
      })}
    </div>
  );

  // visão por empresa: a escolhida (ou a 1ª com dados) e os meses dela, do mais recente ao 1º com dado
  const empresa = empresas.find((e) => e.id === empresaId) ?? empresas[0] ?? null;
  const mesesDaEmpresa = empresa
    ? [...meses].reverse().map((m) => ({ m, r: resumoDaEmpresa(empresa.contas, meses, m) })).filter(({ r }) => !r.vazio || r.total > 0)
    : [];
  const fechadosDaEmpresa = mesesDaEmpresa.filter(({ m, r }) => m !== atual && r.fechado).length;
  const mesesEncerrados = mesesDaEmpresa.filter(({ m }) => m !== atual).length;
  const totalEmp = mesesDaEmpresa.reduce((acc, { r }) => ({ total: acc.total + r.total, pend: acc.pend + r.pend, comp: acc.comp + r.comComprovante }), { total: 0, pend: 0, comp: 0 });
  const nomeCurto = (m: string) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc]">
      <div className="px-8 py-5 bg-white border-b border-[#e8eaed] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Controle de importação</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">{visao === "mes" ? "Escolha o mês: o que já foi importado, o que falta categorizar e se o mês está fechado." : "Escolha a empresa: todos os meses dela, um por linha."}</p>
          <div className="mt-2 inline-flex rounded-lg border border-[#e8eaed] bg-[#f8fafc] p-0.5 text-[13px]">
            {([["mes", "Por mês"], ["empresa", "Por empresa"]] as const).map(([k, rotulo]) => (
              <button key={k} onClick={() => setVisao(k)} className={`px-3 h-7 rounded-md font-medium ${visao === k ? "bg-white shadow-sm text-[#1a202c]" : "text-[#6b7280]"}`}>{rotulo}</button>
            ))}
          </div>
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
          {visao === "empresa" && empresa && (
            <>
              <select className="h-9 rounded-lg border border-[#e8eaed] bg-white px-3 text-[13px] font-medium text-[#374151]" value={empresa.id}
                onChange={(ev) => { setEmpresaId(ev.target.value); setMesesAbertos({}); }}>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Meses fechados", `${fechadosDaEmpresa} de ${mesesEncerrados}`],
                  ["Sem categoria", n(totalEmp.pend)],
                  ["Com comprovante", `${n(totalEmp.comp)} de ${n(totalEmp.total)}`],
                ].map(([rotulo, valor]) => (
                  <div key={rotulo} className="rounded-xl bg-white border border-[#e8eaed] px-4 py-3">
                    <div className="text-[12.5px] text-[#6b7280]">{rotulo}</div>
                    <div className="text-[24px] font-semibold text-[#1a202c] tabular-nums">{valor}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-white border border-[#e8eaed] overflow-hidden text-[13px]">
                <div className={`${grade} px-5 py-2.5 border-b border-[#f3f4f6] text-[12px] text-[#9ca3af]`}>
                  <span>{empresa.name}</span><span>Importação</span><span>Categorização</span><span>Comprovantes</span><span className="text-right">Mês</span>
                </div>
                {mesesDaEmpresa.length === 0 && <div className="px-5 py-4 text-[#9ca3af]">Esta empresa ainda não tem dados.</div>}
                {mesesDaEmpresa.map(({ m, r }) => {
                  const aberto = !!mesesAbertos[m];
                  return (
                    <div key={m} className="border-b border-[#f3f4f6] last:border-b-0">
                      <button className={`${grade} w-full px-5 py-2.5 text-left hover:bg-[#fafbfc]`} onClick={() => setMesesAbertos((p) => ({ ...p, [m]: !p[m] }))}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-[#9ca3af] text-[10px] w-3 shrink-0">{aberto ? "▾" : "▸"}</span>
                          <span className="font-medium text-[#374151]">{nomeCurto(m)}</span>
                        </span>
                        {celulas(r, m === atual)}
                      </button>
                      {aberto && contasDoMes(empresa, m, "pl-6")}
                    </div>
                  );
                })}
              </div>
              <p className="text-[12px] text-[#6b7280]">Mês <strong className="text-emerald-700">fechado</strong> = todas as contas importadas do dia 1 ao último dia e nenhum lançamento sem categoria. Clique no mês pra ver conta a conta; clique numa conta pra ver aquele mês dela e <strong>importar só ela</strong>.</p>
            </>
          )}
          {visao === "mes" && <>
          {/* faixa dos meses: uma linha por ano */}
          <div className="space-y-1.5">
            {anos.map((ano) => (
              <div key={ano} className="grid grid-cols-[40px_repeat(12,minmax(0,1fr))] gap-1.5 items-stretch">
                <span className="self-center text-[12px] text-[#9ca3af]">{ano}</span>
                {Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`).map((m) => {
                  if (!meses.includes(m)) return <span key={m} />;
                  const rs = resumoDoMes(m);
                  const f = rs.filter(({ r }) => r.fechado).length;
                  const ativo = m === mes;
                  return (
                    <button key={m} onClick={() => setMesEscolhido(m)}
                      className={`rounded-lg bg-white px-1 py-1.5 text-center text-[12px] leading-tight ${ativo ? "border-2 border-[#00b9a5]" : "border border-[#e8eaed] hover:border-[#cbd5e1]"}`}>
                      <div className={`font-medium ${ativo ? "text-[#1a202c]" : "text-[#4b5563]"}`}>{MESES[+m.slice(5, 7) - 1]}</div>
                      {m === atual ? <div className="text-[11px] text-[#9ca3af]">agora</div>
                        : rs.length === 0 ? <div className="text-[11px] text-[#d1d5db]">—</div>
                        : <div className={`text-[11px] ${f === rs.length ? "text-emerald-600" : "text-amber-700"}`}>{f}/{rs.length}</div>}
                    </button>
                  );
                })}
              </div>
            ))}
            <p className="text-[11.5px] text-[#9ca3af]">Em cada mês: empresas fechadas / empresas com dados.</p>
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
              <span>{nomeMes}{mes === atual ? " · em andamento" : ""}</span><span>Importação</span><span>Categorização</span><span>Comprovantes</span><span className="text-right">Mês</span>
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
                    {celulas(r, false)}
                  </button>
                  {aberta && contasDoMes(e, mes, "pl-8")}
                </div>
              );
            })}
          </div>

          <p className="text-[12px] text-[#6b7280]">Mês <strong className="text-emerald-700">fechado</strong> = todas as contas importadas do dia 1 ao último dia e nenhum lançamento sem categoria. Clique na empresa pra ver conta a conta; clique numa conta pra ver o mês dela e <strong>importar só ela</strong>.</p>

          {vazias.length > 0 && (
            <div>
              <button className="text-[12.5px] text-[#6b7280] hover:text-[#374151]" onClick={() => setVaziasAbertas((v) => !v)}>
                {vaziasAbertas ? "▾" : "▸"} {vazias.length} conta{vazias.length !== 1 ? "s" : ""} de empresas sem nenhum dado
              </button>
              {vaziasAbertas && (
                <ul className="mt-1 pl-5 text-[12px] text-[#6b7280] space-y-0.5">
                  {vazias.map((c) => (
                    <li key={c.id}>
                      <button className="hover:text-[#00a896] hover:underline" onClick={() => abrirConta(c, mes)}>
                        {nomeEmpresa(c.companyId)} · {rotuloDaConta(c, nomeEmpresa(c.companyId)).titulo}{rotuloDaConta(c, nomeEmpresa(c.companyId)).detalhe ? ` · ${rotuloDaConta(c, nomeEmpresa(c.companyId)).detalhe}` : ""}
                      </button>
                    </li>
                  ))}
                  <li className="text-[11.5px] text-[#9ca3af] pt-1">Clique pra importar — ou apague a conta em Contas, se ela não é usada.</li>
                </ul>
              )}
            </div>
          )}
          </>}
        </div>
      </div>

      {contaDoPainel && (
        <PainelDaConta conta={contaDoPainel}
          irmas={dados.accounts.filter((a) => a.id !== contaDoPainel.id && a.companyId === contaDoPainel.companyId && a.bank === contaDoPainel.bank)}
          empresa={nomeEmpresa(contaDoPainel.companyId)} mes={painelMes ?? mes} onFechar={() => { setPainelId(null); setPainelMes(null); }} onImportou={carregar} />
      )}
    </div>
  );
}
