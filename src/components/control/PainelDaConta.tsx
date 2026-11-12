"use client";

import { useEffect, useRef, useState } from "react";
import { INICIO_DOS_FECHAMENTOS, type EstadoImp } from "@/lib/mesFechado";
import { textoDoArquivo } from "@/lib/textoDoArquivo";

/**
 * Painel de UMA conta no Controle de importação (decisão do dono em 2026-11-12: "todas as opções de
 * importação devem ficar nessa tela. Pra todas as contas com todas as opções de importação de cada uma. De
 * modo que o usuário possa clicar na conta e importar só ela"). Mostra o mês escolhido (o que cobre, o que
 * falta categorizar) e, embaixo, só as opções que valem pro banco da conta:
 *  - API (Mercury, Wise, Revolut, BTG): escolhe a extração na 1ª vez (depois fica fixa) e sincroniza "desde";
 *  - Mercury: separar extrações (1 conta por extração);
 *  - OFX (BTG, XP, Itaú); CSV da Revolut (código Facebk e cartão);
 *  - arquivo sem período (planilha Husky, Dolafy, CSV genérico): importa e PERGUNTA o período que o arquivo
 *    cobre, já preenchido com a 1ª e a última data lidas — só a confirmação grava a cobertura.
 */

export type MesDaConta = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number };
export type ContaDoControle = {
  id: string; name: string; bank: string; currency: string; companyId: string;
  fonte: string | null; configurada: boolean; extracao: string | null; contaBanco: string | null;
  nuncaImportada: boolean; cobertaAte: string | null;
  ultimaImportacao: { quando: string; quem: string | null; fonte: string; arquivo: string | null } | null;
  meses: Record<string, MesDaConta>;
};
type Importacao = { de: string; ate: string; fonte: string; quando: string; quem: string | null; arquivo: string | null };
type Extracao = { id: string | null; rotulo: string; extra?: Record<string, unknown> };

export const BANCOS_API = ["Mercury", "Wise", "Revolut", "BTG"];
export const BANCOS_OFX = ["BTG", "XP", "Itaú"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const ultimoDia = (ateIso: string) => br(new Date(new Date(ateIso).getTime() - 1).toISOString());
const FONTE: Record<string, string> = { api: "Sync da API", ofx: "OFX", arquivo: "Arquivo" };

/** Como a conta aparece: banco e moeda, o nome só quando diz algo além da empresa, e o nº da conta do OFX. */
export function rotuloDaConta(c: ContaDoControle, nomeEmpresa: string): { titulo: string; detalhe: string | null } {
  const nome = c.name.trim();
  const repete = !nome || nome.toLowerCase() === nomeEmpresa.trim().toLowerCase() || nome.toLowerCase() === c.bank.toLowerCase();
  const partes = [repete ? null : nome, c.contaBanco ? `conta ${c.contaBanco}` : null].filter(Boolean);
  return { titulo: `${c.bank} ${c.currency}`, detalhe: partes.length ? partes.join(" · ") : null };
}

export function dicaImp(m: MesDaConta) {
  switch (m.imp) {
    case "completo": return "importado por inteiro";
    case "parcial": return `importado só em parte: ${(m.pedacos ?? []).map((p) => `${br(p.de)}–${ultimoDia(p.ate)}`).join(", ")}`;
    case "sem_comprovacao": return "tem lançamentos, mas nenhuma importação registrada cobre o mês";
    case "faltando": return "nada importado neste mês";
    default: return "a conta ainda não tinha dados neste mês";
  }
}

const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50 shrink-0";
const linha = "flex flex-wrap items-center gap-2 py-2.5 border-t border-[#f3f4f6]";
const caixa = "h-8 rounded-lg border border-[#e8eaed] px-2 text-[13px] bg-white";

async function json(r: Promise<Response>) {
  try {
    const res = await r;
    const j = await res.json().catch(() => ({}));
    return res.ok ? j : { error: j.error ?? `erro ${res.status}` };
  } catch { return { error: "sem resposta do servidor (se demorou muito, recarregue daqui a pouco pra ver o que entrou)" }; }
}

export function PainelDaConta({ conta, empresa, mes, onFechar, onImportou }: {
  conta: ContaDoControle; empresa: string; mes: string; onFechar: () => void; onImportou: () => void;
}) {
  const { titulo, detalhe } = rotuloDaConta(conta, empresa);
  const m = conta.meses[mes];
  const [importacoes, setImportacoes] = useState<Importacao[] | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const avisar = (ok: boolean, texto: string) => setAviso({ ok, texto });
  const recarregar = () => {
    onImportou();
    fetch(`/api/coverage/detalhe?accountId=${conta.id}&mes=${mes}`).then((x) => x.json()).then((r) => setImportacoes(r.importacoes ?? [])).catch(() => {});
  };
  useEffect(() => {
    let vivo = true;
    fetch(`/api/coverage/detalhe?accountId=${conta.id}&mes=${mes}`).then((x) => x.json()).then((r) => { if (vivo) setImportacoes(r.importacoes ?? []); }).catch(() => { if (vivo) setImportacoes([]); });
    return () => { vivo = false; };
  }, [conta.id, mes]);

  const temApi = BANCOS_API.includes(conta.bank);
  const temOfx = BANCOS_OFX.includes(conta.bank);
  const arquivo = conta.bank === "Husky" ? "husky" : conta.bank === "Dolafy" ? "dolafy" : !temApi && !temOfx ? "csv" : null;

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-xl max-w-xl w-full max-h-[90vh] overflow-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-bold text-[#1a202c]">{titulo}{detalhe && <span className="font-normal text-[#6b7280]"> · {detalhe}</span>}</h2>
            <p className="text-[12.5px] text-[#6b7280]">{empresa}{conta.fonte ? ` · ${FONTE[conta.fonte] ?? conta.fonte}` : ""}{conta.cobertaAte ? ` · importada até ${br(conta.cobertaAte)}` : ""}</p>
          </div>
          <button className="text-[#9ca3af] hover:text-[#374151]" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        {m && (
          <div className="rounded-xl bg-[#f8fafc] px-4 py-3 text-[13px] space-y-1">
            <div className="text-[12px] text-[#6b7280]">{MESES_LONGOS[+mes.slice(5, 7) - 1]} {mes.slice(0, 4)}</div>
            <div>
              <span className={m.imp === "completo" ? "text-emerald-700" : m.imp === "parcial" ? "text-amber-700" : m.imp === "antes" ? "text-[#6b7280]" : "text-red-600"}>{dicaImp(m)}</span>
              {m.total > 0 && <span className="text-[#374151]"> · {m.total} lançamento(s) · <span className={m.semCategoria ? "text-amber-700" : "text-emerald-700"}>{m.semCategoria} sem categoria</span></span>}
            </div>
            {!importacoes ? <div className="text-[12px] text-[#9ca3af]">carregando…</div>
              : importacoes.length === 0 ? <div className="text-[12px] text-[#9ca3af]">Nenhuma importação cobre este mês.</div>
              : importacoes.map((i, k) => (
                  <div key={k} className="text-[12px] text-[#6b7280]">
                    {FONTE[i.fonte] ?? i.fonte} · cobre {br(i.de)} a {ultimoDia(i.ate)} · em {br(i.quando)}{i.quem ? ` por ${i.quem}` : ""}{i.arquivo ? ` · ${i.arquivo}` : ""}
                  </div>
                ))}
          </div>
        )}

        <div>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[#9ca3af] mb-1">Importar esta conta</h3>
          {temApi && <OpcaoApi conta={conta} empresa={empresa} avisar={avisar} depois={recarregar} />}
          {conta.bank === "Mercury" && <OpcaoSepararExtracoes conta={conta} avisar={avisar} depois={recarregar} />}
          {temOfx && <OpcaoOfx conta={conta} avisar={avisar} depois={recarregar} />}
          {conta.bank === "Revolut" && <OpcaoCsvRevolut avisar={avisar} depois={recarregar} />}
          {arquivo && <OpcaoArquivo conta={conta} kind={arquivo} avisar={avisar} depois={recarregar} />}
          {conta.bank === "BTG" && <p className="text-[11.5px] text-[#9ca3af] pt-1">Cada conta usa uma fonte só: API do BTG ou OFX — a que você usar primeiro.</p>}
        </div>

        {aviso && <div className={`rounded-lg px-3 py-2 text-[12.5px] ${aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{aviso.texto}</div>}
        <p className="text-[11.5px] text-[#9ca3af]">Token do banco e conexão (Revolut, BTG) ficam em Contas.</p>
      </div>
    </div>
  );
}

type Opcao = { avisar: (ok: boolean, texto: string) => void; depois: () => void };

/** Sincronizar pela API: na 1ª vez escolhe a extração (depois ela fica fixa na conta) e o "desde". */
function OpcaoApi({ conta, empresa, avisar, depois }: Opcao & { conta: ContaDoControle; empresa: string }) {
  const [extracoes, setExtracoes] = useState<Extracao[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<string>(conta.configurada ? conta.extracao ?? "" : "");
  const [desde, setDesde] = useState(INICIO_DOS_FECHAMENTOS);
  const [rodando, setRodando] = useState(false);
  const fixa = conta.configurada && !conta.nuncaImportada; // extração fixa depois que a conta recebeu dados

  useEffect(() => {
    let vivo = true;
    const listar = async (): Promise<Extracao[] | { error: string }> => {
      const empresaMin = empresa.toLowerCase();
      if (conta.bank === "Mercury") {
        const l = await json(fetch(`/api/sync/mercury/accounts?accountId=${conta.id}`));
        if (!Array.isArray(l)) return { error: l.error ?? "a Mercury não listou as extrações" };
        const daEmpresa = l.filter((x: { legalBusinessName?: string; entity?: string }) => {
          const a = (x.legalBusinessName ?? "").toLowerCase(), b = (x.entity ?? "").toLowerCase();
          return a.includes(empresaMin) || empresaMin.includes(a) || b.includes(empresaMin) || empresaMin.includes(b);
        });
        return (daEmpresa.length ? daEmpresa : l).map((x: { id: string; name: string; kind?: string; entity?: string }) => ({ id: x.id, rotulo: `${x.kind === "credit" ? "Crédito · " : ""}${x.name}`, extra: { entity: x.entity, kind: x.kind } }));
      }
      if (conta.bank === "Wise") {
        const l = await json(fetch(`/api/sync/wise/accounts?accountId=${conta.id}`));
        return Array.isArray(l) ? l.map((p: { id: string; label: string }) => ({ id: String(p.id), rotulo: p.label })) : { error: l.error ?? "a Wise não listou os perfis" };
      }
      if (conta.bank === "Revolut") {
        const l = await json(fetch(`/api/revolut/accounts?accountId=${conta.id}`));
        if (!Array.isArray(l)) return { error: l.error ?? "a Revolut não listou as contas (conectada em Contas?)" };
        return [{ id: null, rotulo: "Todas as contas da Revolut" }, ...l.map((a: { id: string; name: string; currency: string }) => ({ id: a.id, rotulo: `${a.name} (${a.currency})` }))];
      }
      const l = await json(fetch(`/api/btg/contas?accountId=${conta.id}`));
      return Array.isArray(l) ? l.map((c: { accountId: string; numero?: string | null; number?: string | null }) => ({ id: c.accountId, rotulo: `Conta ${c.numero ?? c.number ?? c.accountId}` })) : { error: l.error ?? "o BTG não listou as contas (conectado em Contas?)" };
    };
    listar().then((r) => {
      if (!vivo) return;
      if (Array.isArray(r)) {
        setExtracoes(r);
        setEscolhida((atual) => atual || (conta.configurada ? atual : r.length === 1 ? r[0].id ?? "" : conta.bank === "Revolut" ? "" : atual));
      } else setErroLista(r.error);
    });
    return () => { vivo = false; };
  }, [conta.id, conta.bank, conta.configurada, empresa]);

  async function sincronizar() {
    const ext = extracoes?.find((e) => (e.id ?? "") === escolhida);
    const from = `${desde}-01`;
    let corpo: Record<string, unknown>;
    let rota: string;
    if (conta.bank === "Mercury") {
      if (!escolhida) return avisar(false, "escolha a extração da Mercury");
      rota = "/api/sync/mercury";
      corpo = { accountId: conta.id, mercuryAccountId: escolhida, from, entity: ext?.extra?.entity, kind: ext?.extra?.kind === "credit" ? "creditCard" : "account" };
    } else if (conta.bank === "Wise") {
      if (!escolhida) return avisar(false, "escolha o perfil da Wise");
      rota = "/api/sync/wise";
      corpo = { accountId: conta.id, profileId: escolhida, from };
    } else if (conta.bank === "Revolut") {
      rota = "/api/sync/revolut";
      corpo = { accountId: conta.id, revolutAccountId: escolhida || null, from };
    } else {
      rota = "/api/sync/btg";
      corpo = { accountId: conta.id, btgAccountId: escolhida || null, from };
    }
    setRodando(true);
    const r = await json(fetch(rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
    setRodando(false);
    if (r.error) return avisar(false, `Sincronizar: ${r.error}`);
    avisar(true, `Sincronizado desde ${desde.slice(5)}/${desde.slice(0, 4)}: ${r.imported ?? 0} lançamento(s) novo(s)${r.skipped != null ? ` · ${r.skipped} já existiam` : ""}${r.incompleto ? " · ⚠️ a leitura parou no meio — rode de novo" : ""}`);
    depois();
  }

  return (
    <div className={linha}>
      <span className="text-[13px] text-[#374151] w-full">Sincronizar pela API</span>
      {erroLista ? <span className="text-[12px] text-red-600 w-full">{erroLista}</span> : (
        <select className={`${caixa} flex-1 min-w-[180px]`} value={escolhida} disabled={fixa || !extracoes} onChange={(e) => setEscolhida(e.target.value)}
          title={fixa ? "extração fixa desta conta — pra outra extração, use outra conta" : ""}>
          {!extracoes ? <option>carregando as extrações…</option> : (
            <>
              {!conta.configurada && conta.bank !== "Revolut" && <option value="">escolha a extração…</option>}
              {extracoes.map((e) => <option key={e.id ?? "todas"} value={e.id ?? ""}>{e.rotulo}</option>)}
              {conta.configurada && conta.extracao && !extracoes.some((e) => e.id === conta.extracao) && <option value={conta.extracao}>extração configurada ({conta.extracao.slice(-6)})</option>}
            </>
          )}
        </select>
      )}
      <span className="text-[12px] text-[#6b7280]">desde</span>
      <input type="month" className={caixa} value={desde} min="2020-01" onChange={(e) => setDesde(e.target.value)} />
      <button className={btn} onClick={sincronizar} disabled={rodando || !!erroLista}>{rodando ? "Sincronizando…" : "Sincronizar"}</button>
    </div>
  );
}

/** Mercury: 1 conta por extração — plano antes de aplicar. */
function OpcaoSepararExtracoes({ conta, avisar, depois }: Opcao & { conta: ContaDoControle }) {
  type Plano = { extracoes: Array<{ id: string; nome: string; tipo: string; lancamentos: number; fica: boolean; contaExistente: string | null }>; semExtracao: number; criadas?: Array<{ nome: string }>; duplicadas?: number; error?: string };
  const [plano, setPlano] = useState<Plano | null>(null);
  const [rodando, setRodando] = useState(false);
  async function verPlano() {
    setRodando(true);
    setPlano(await json(fetch(`/api/accounts/${conta.id}/extracoes`)));
    setRodando(false);
  }
  async function separar() {
    setRodando(true);
    const r = await json(fetch(`/api/accounts/${conta.id}/extracoes`, { method: "POST" }));
    setRodando(false);
    setPlano(r);
    if (!r.error) { avisar(true, `Separado: ${r.criadas?.length ?? 0} conta(s) nova(s). Sincronize cada uma desde o mês que você quer cobrir.`); depois(); }
  }
  return (
    <div className={linha}>
      <span className="text-[13px] text-[#374151] flex-1">Separar extrações <span className="text-[#9ca3af]">· 1 conta por extração da Mercury</span></span>
      {!plano?.extracoes && <button className={btn} onClick={verPlano} disabled={rodando}>{rodando ? "Lendo a Mercury…" : "Ver plano"}</button>}
      {plano?.error && <span className="text-[12px] text-red-600 w-full">{plano.error}</span>}
      {plano?.extracoes && (
        <div className="w-full text-[12.5px] space-y-1">
          {plano.extracoes.map((e) => (
            <div key={e.id} className="flex justify-between gap-2"><span className="text-[#374151]">{e.nome} <span className="text-[#9ca3af]">· {e.tipo}</span></span><span className="text-[#6b7280] tabular-nums">{e.lancamentos} lanç. → {e.fica ? "fica nesta conta" : e.contaExistente ?? "conta nova"}</span></div>
          ))}
          {plano.semExtracao > 0 && <div className="text-amber-700">{plano.semExtracao} lançamento(s) não aparecem em nenhuma extração — ficam nesta conta.</div>}
          {!plano.criadas && plano.extracoes.length > 1 && <button className={btn} onClick={separar} disabled={rodando}>{rodando ? "Separando…" : `Separar em ${plano.extracoes.length} contas`}</button>}
          {!plano.criadas && plano.extracoes.length === 1 && <div className="text-[#6b7280]">A chave tem uma extração só — nada a separar.</div>}
        </div>
      )}
    </div>
  );
}

function Arquivo({ rotulo, accept, aoEscolher, ocupado }: { rotulo: string; accept: string; aoEscolher: (f: File) => void; ocupado: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) aoEscolher(f); e.target.value = ""; }} />
      <button className={btn} onClick={() => ref.current?.click()} disabled={ocupado}>{ocupado ? "Importando…" : rotulo}</button>
    </>
  );
}

function OpcaoOfx({ conta, avisar, depois }: Opcao & { conta: ContaDoControle }) {
  const [ocupado, setOcupado] = useState(false);
  async function importar(f: File) {
    setOcupado(true);
    const r = await json(fetch(`/api/import/ofx?accountId=${encodeURIComponent(conta.id)}`, {
      method: "POST", headers: { "Content-Type": "application/x-ofx", "x-filename": encodeURIComponent(f.name) }, body: await textoDoArquivo(f),
    }));
    setOcupado(false);
    if (r.error) return avisar(false, `OFX: ${r.error}`);
    avisar(true, `OFX ${f.name}: ${r.gravados} lançamento(s) novo(s) · ${r.jaExistiam} já existiam${r.linhasDeSaldoIgnoradas ? ` · ${r.linhasDeSaldoIgnoradas} linha(s) de saldo ignorada(s)` : ""} · conta do arquivo ${r.contaBanco}`);
    depois();
  }
  return (
    <div className={linha}>
      <span className="text-[13px] text-[#374151] flex-1">Extrato OFX <span className="text-[#9ca3af]">· o período do arquivo conta como importado</span></span>
      <Arquivo rotulo="Importar OFX" accept=".ofx,application/x-ofx" aoEscolher={importar} ocupado={ocupado} />
    </div>
  );
}

function OpcaoCsvRevolut({ avisar, depois }: Opcao) {
  const [ocupado, setOcupado] = useState(false);
  async function importar(f: File) {
    setOcupado(true);
    const r = await json(fetch("/api/admin/import-revolut-csv", { method: "POST", headers: { "Content-Type": "text/csv", "x-filename": encodeURIComponent(f.name) }, body: await f.text() }));
    setOcupado(false);
    if (r.error) return avisar(false, `CSV da Revolut: ${r.error}`);
    avisar(true, `CSV da Revolut: ${r.metaRefGravados ?? 0} código(s) Facebk gravado(s) · ${r.jaTinhamOMesmoCodigo ?? 0} já tinham · ${r.cartoesPreenchidos ?? 0} cartão(ões) preenchido(s)${r.semTransacaoNoBanco ? ` · ⚠️ ${r.semTransacaoNoBanco} sem transação no banco (sincronize a API antes)` : ""}`);
    depois();
  }
  return (
    <div className={linha}>
      <span className="text-[13px] text-[#374151] flex-1">CSV da Revolut <span className="text-[#9ca3af]">· completa o código Facebk e o cartão (não traz lançamento novo)</span></span>
      <Arquivo rotulo="Importar CSV" accept=".csv,text/csv" aoEscolher={importar} ocupado={ocupado} />
    </div>
  );
}

/** Arquivo sem período dentro: importa, depois pergunta "cobre de … a …?" (só a confirmação grava a cobertura). */
function OpcaoArquivo({ conta, kind, avisar, depois }: Opcao & { conta: ContaDoControle; kind: "husky" | "dolafy" | "csv" }) {
  const [ocupado, setOcupado] = useState(false);
  const [pendente, setPendente] = useState<{ importLogId: string; de: string; ate: string } | null>(null);
  const cfg = {
    husky: { titulo: "Planilha da Husky (XLS)", rota: "/api/transactions/import/husky", accept: ".xls,.xlsx" },
    dolafy: { titulo: "Extrato da Dolafy (CSV)", rota: "/api/transactions/import/dolafy", accept: ".csv,text/csv" },
    csv: { titulo: "Planilha CSV (data, descrição, valor)", rota: "/api/transactions/import", accept: ".csv,text/csv" },
  }[kind];
  async function importar(f: File) {
    setOcupado(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("accountId", conta.id);
    const r = await json(fetch(cfg.rota, { method: "POST", body: fd }));
    setOcupado(false);
    if (r.error) return avisar(false, `${cfg.titulo}: ${r.error}`);
    avisar(true, `${f.name}: ${r.imported ?? 0} lançamento(s) novo(s)${r.skipped != null ? ` · ${r.skipped} já existiam` : ""}. Confirme o período que o arquivo cobre.`);
    if (r.importLogId && r.periodo) setPendente({ importLogId: r.importLogId, de: r.periodo.de, ate: r.periodo.ate });
    depois();
  }
  async function confirmar() {
    if (!pendente) return;
    const r = await json(fetch("/api/coverage/periodo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: conta.id, ...pendente }) }));
    if (r.error) return avisar(false, `Período: ${r.error}`);
    avisar(true, `Período ${br(pendente.de)} a ${br(pendente.ate)} marcado como importado.`);
    setPendente(null);
    depois();
  }
  return (
    <div className={linha}>
      <span className="text-[13px] text-[#374151] flex-1">{cfg.titulo}</span>
      <Arquivo rotulo="Importar arquivo" accept={cfg.accept} aoEscolher={importar} ocupado={ocupado} />
      {pendente && (
        <div className="w-full flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <span>Este arquivo cobre de</span>
          <input type="date" className={caixa} value={pendente.de} onChange={(e) => setPendente({ ...pendente, de: e.target.value })} />
          <span>a</span>
          <input type="date" className={caixa} value={pendente.ate} onChange={(e) => setPendente({ ...pendente, ate: e.target.value })} />
          <button className={btn} onClick={confirmar}>Confirmar período</button>
          <span className="w-full text-[11.5px] text-amber-800">Sem confirmar, os lançamentos ficam, mas o mês não conta como importado.</span>
        </div>
      )}
    </div>
  );
}
