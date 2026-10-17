"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, XCircle, Circle, ChevronDown, ChevronRight, Upload, Download } from "lucide-react";
import ReceiptsImporter from "@/components/receipts-importer";

type Passo = { feito: boolean };
type Conta = {
  id: string; nome: string; banco: string; empresa: string; moeda: string;
  manual: boolean; configurada: boolean; temChave: boolean; ultimaTransacao: string | null; sincronizadaAte: string | null;
  cobrancasMetaNoMes: number; semCodigoNoMes: number;
};
type ConexaoMeta = { operationId: string; operacao: string; conectado: boolean; valido: boolean | null; expiraEm: string | null; erro: string | null };
// mesmos formatos de src/lib/cobrancasMeta.ts (valores SEMPRE por moeda: USD e EUR não se somam)
type Valores = Record<string, number>;
type Parcial = { qtd: number; valor: Valores };
type Situacao = "ok" | "sem_pdf" | "sem_codigo";
type Cobranca = { id: string; data: string; descricao: string; valor: number; moeda: string; codigo: string | null; situacao: Situacao; contaAnuncio: string | null; contaAnuncioNome: string | null };
type Cartao = {
  chave: string; banco: string; conta: string; cartaoFinal: string | null; cartaoNome: string | null;
  total: number; ok: number; semPdf: number; semCodigo: number; valorOk: Valores; valorPendente: Valores;
};
type Importacao = { id: string; tipo: string; arquivo: string | null; quem: string; quando: string; de: string | null; ate: string | null; resumo: Record<string, unknown> };
type Data = {
  mesesDisponiveis?: string[];
  mesesStatus?: Record<string, { liberado: boolean; motivo: string | null }>;
  bloqueado?: string | null; // mês com a importação incompleta → só o motivo + as contas
  companies?: { id: string; name: string }[];
  month?: string | null;
  contas?: Conta[];
  metaConexoes?: ConexaoMeta[];
  pendentes?: { total: number; semCodigo: number; codigoSemPdf: number };
  totais?: { total: Parcial; checado: Parcial; pendente: Parcial; semCodigo: Parcial; semPdf: Parcial };
  cartoes?: Cartao[];
  importacoes?: Importacao[];
  passos?: {
    bancos: Passo & { transacoesMeta: number };
    revolutCsv: Passo & { semCodigo: number };
    meta: Passo & { cobrancas: number };
    faturas: Passo & { comFatura: number; semFatura: number };
  };
};
type Msg = { tipo: "ok" | "aviso" | "erro"; texto: string };
type Estado = "ok" | "aviso" | "erro" | "pendente";
type J = Record<string, unknown>;

const br = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const brCurto = (d: string | null | undefined) => (d ? br(d).slice(0, 5) : "—");
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const n = (v: number) => v.toLocaleString("pt-BR");
const dinheiro = (v: number, moeda: string) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda}`;
/** Valor por moeda, a maior primeiro: "773.240,24 USD · 80,00 EUR". */
const valores = (v: Valores | undefined) => {
  const itens = Object.entries(v ?? {}).sort((a, b) => b[1] - a[1]);
  return itens.length ? itens.map(([moeda, valor]) => dinheiro(valor, moeda)).join(" · ") : "—";
};
const nomeCartao = (c: { cartaoNome: string | null; cartaoFinal: string | null }) =>
  c.cartaoFinal ? `${c.cartaoNome ? `${c.cartaoNome} ` : ""}··${c.cartaoFinal}` : "sem cartão no extrato";
const SITUACAO: Record<Situacao, { texto: string; cor: string }> = {
  ok: { texto: "Checado", cor: "bg-emerald-50 text-emerald-700" },
  sem_pdf: { texto: "Sem PDF", cor: "bg-amber-50 text-amber-700" },
  sem_codigo: { texto: "Sem código", cor: "bg-rose-50 text-rose-700" },
};
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Resposta do import do CSV → uma frase. */
function msgCsv(j: J): Msg {
  const falta = num(j.semTransacaoNoBanco);
  return {
    tipo: falta ? "aviso" : "ok",
    texto: `CSV da Revolut: ${n(num(j.metaRefGravados))} código(s) gravado(s), ${n(num(j.jaTinhamOMesmoCodigo))} já tinham` +
      (falta ? ` · ${n(falta)} do CSV ainda não estão no banco — sincronize a Revolut na aba Accounts e suba de novo.` : "."),
  };
}

/** Uma linha do histórico → resultado curto. */
function resultadoImportacao(i: Importacao): string {
  const r = i.resumo;
  if (i.tipo === "csv_revolut") {
    const porConta = Object.entries((r.porConta as Record<string, number>) ?? {}).map(([c, q]) => `${c}: ${n(q)}`).join(" · ");
    return `${n(num(r.gravados))} códigos novos · ${n(num(r.jaTinham))} já tinham · ${n(num(r.semTransacaoNoBanco))} sem par${porConta ? ` (${porConta})` : ""}`;
  }
  return `${n(num(r.inseridos))} faturas lidas`;
}

function Icone({ estado }: { estado: Estado }) {
  if (estado === "ok") return <CheckCircle2 className="w-[18px] h-[18px] text-emerald-500 shrink-0" />;
  if (estado === "aviso") return <AlertCircle className="w-[18px] h-[18px] text-amber-500 shrink-0" />;
  if (estado === "erro") return <XCircle className="w-[18px] h-[18px] text-rose-500 shrink-0" />;
  return <Circle className="w-[18px] h-[18px] text-[#d1d5db] shrink-0" />;
}

function Passo({ n: numero, titulo, estado, status, acao, children }: { n: number; titulo: string; estado: Estado; status: React.ReactNode; acao?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="border-b border-[#f3f4f6] last:border-b-0">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Icone estado={estado} />
        <span className="text-[14px] font-medium text-[#1a202c] w-56 shrink-0">{numero} · {titulo}</span>
        <span className="flex-1 text-[13px] text-[#6b7280] min-w-0">{status}</span>
        {acao}
      </div>
      {children && <div className="px-5 pb-4 pl-[52px]">{children}</div>}
    </div>
  );
}

export default function FechamentoPage() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState("");
  const [company, setCompany] = useState(""); // "" = todas as empresas do escopo
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [aberto, setAberto] = useState<{ contas: boolean; pdfs: boolean }>({ contas: false, pdfs: false });
  // resumo por cartão: qual cartão está aberto e as transações já buscadas (chave inclui mês/empresa/recarga)
  const [cartaoAberto, setCartaoAberto] = useState<string | null>(null);
  const [transacoes, setTransacoes] = useState<Record<string, Cobranca[] | "carregando" | "erro">>({});

  // recarregar = bump do contador; o efeito abaixo busca de novo (mês/empresa/contador)
  const [recarga, setRecarga] = useState(0);
  const reload = useCallback(() => setRecarga((k) => k + 1), []);
  useEffect(() => {
    let vivo = true;
    const qs = new URLSearchParams();
    if (month) qs.set("month", month);
    if (company) qs.set("company", company);
    fetch(`/api/fechamento?${qs.toString()}`).then((r) => r.json()).then((d: Data) => {
      if (!vivo) return;
      setData(d);
      if (!month && d.month) setMonth(d.month);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [month, company, recarga]);
  // voltou da janela da Meta (reconectar) → atualiza sem recarregar a página
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  async function onCsv(file: File) {
    setBusy("csv"); setMsg(null);
    try {
      const r = await fetch("/api/admin/import-revolut-csv", { method: "POST", headers: { "Content-Type": "text/csv", "x-filename": encodeURIComponent(file.name) }, body: await file.text() });
      const j: J = await r.json().catch(() => ({}));
      setMsg(r.ok ? msgCsv(j) : { tipo: "erro", texto: `CSV da Revolut: ${String(j.error ?? `erro ${r.status}`)}` });
      recarregarTudo();
    } catch (e) {
      setMsg({ tipo: "erro", texto: `CSV da Revolut: ${(e as Error).message}` });
    } finally { setBusy(null); }
  }

  const alternar = (k: keyof typeof aberto) => setAberto((a) => ({ ...a, [k]: !a[k] }));
  const qsCobrancas = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ month, ...(company ? { company } : {}), ...extra });
    return `/api/fechamento/cobrancas?${qs.toString()}`;
  };
  // o foco da janela recarrega o resumo (volta da Meta) mas NÃO mexe no cartão aberto; a lista só é
  // jogada fora quando os dados mudam de fato (import de CSV/PDF → recarregarTudo)
  const chaveCache = (cartao: string) => `${month}|${company}|${cartao}`;
  const recarregarTudo = () => { setTransacoes({}); setCartaoAberto(null); reload(); };
  function abrirCartao(cartao: string) {
    if (cartaoAberto === cartao) { setCartaoAberto(null); return; }
    setCartaoAberto(cartao);
    const k = chaveCache(cartao);
    if (transacoes[k]) return;
    setTransacoes((t) => ({ ...t, [k]: "carregando" }));
    fetch(qsCobrancas({ cartao })).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { cobrancas: Cobranca[] }) => setTransacoes((t) => ({ ...t, [k]: j.cobrancas })))
      .catch(() => setTransacoes((t) => ({ ...t, [k]: "erro" })));
  }
  const p = data?.passos;
  const pend = data?.pendentes;
  const contas = data?.contas ?? [];
  const total = p?.bancos.transacoesMeta ?? 0;
  const comFatura = p?.faturas.comFatura ?? 0;
  const pct = total ? Math.round((comFatura / total) * 1000) / 10 : 0;
  const btn = "h-8 px-3 rounded-lg border border-[#e8eaed] bg-white text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0";

  // passo 1: contas configuradas e o que está fora
  const sincronizaveis = contas.filter((c) => !c.manual);
  const configuradas = sincronizaveis.filter((c) => c.configurada && c.temChave);
  const fora = sincronizaveis.filter((c) => !c.configurada || !c.temChave);
  const ateMin = configuradas.map((c) => c.sincronizadaAte).filter(Boolean).sort()[0] ?? null;
  // passo 2: de qual conta Revolut falta o CSV
  const faltaCsv = contas.filter((c) => c.banco === "Revolut" && c.semCodigoNoMes > 0);
  // passo 3 (OPCIONAL): conexão Meta — não entra na conciliação (extrato × PDF casa pelo código).
  // Só aparece quando há pelo menos uma conexão funcionando; sem isso o Fechamento tem 3 passos.
  const conectadas = (data?.metaConexoes ?? []).filter((m) => m.conectado);
  const temMeta = conectadas.some((m) => m.valido === true);
  const metaRuim = conectadas.filter((m) => m.valido !== true);
  const totais = data?.totais;
  const cartoes = data?.cartoes ?? [];
  const passoFaturas = temMeta ? 4 : 3;

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafc]">
      <div className="flex items-start justify-between gap-4 px-8 py-5 bg-white border-b border-[#e8eaed]">
        <div>
          <h1 className="text-xl font-bold text-[#1a202c]">Fechamento Meta</h1>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Só as cobranças da Meta: cada uma no extrato do banco × a fatura PDF da Meta.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-lg border border-[#e8eaed] bg-white px-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">Todas as empresas</option>
            {(data?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="h-9 rounded-lg border border-[#e8eaed] bg-white px-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {(data?.mesesDisponiveis ?? []).map((m) => {
              const st = data?.mesesStatus?.[m];
              return <option key={m} value={m} disabled={st ? !st.liberado : false} title={st?.motivo ?? undefined}>{m}{st && !st.liberado ? " — bloqueado" : ""}</option>;
            })}
          </select>
        </div>
      </div>

      <div className="p-8 space-y-5 max-w-5xl">
        {data?.bloqueado && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            Ainda não dá pra conferir <strong>{month}</strong>: {data.bloqueado}. Sincronize na aba <Link href="/accounts" className="underline">Accounts</Link> e volte.
          </div>
        )}

        {!data?.bloqueado && p && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { rotulo: "Cobranças Meta", valor: valores(totais?.total.valor), cor: "text-[#1a202c]", nota: `${n(total)} cobranças` },
              { rotulo: "Checado (com fatura)", valor: valores(totais?.checado.valor), cor: total && comFatura === total ? "text-emerald-600" : comFatura ? "text-amber-600" : "text-rose-600",
                nota: `${n(comFatura)} de ${n(total)} · ${pct.toLocaleString("pt-BR")}%` },
              { rotulo: "Pendente", valor: valores(totais?.pendente.valor), cor: (pend?.total ?? 0) ? "text-amber-600" : "text-emerald-600",
                nota: `${n(pend?.semCodigo ?? 0)} sem código (passo 2) · ${n(pend?.codigoSemPdf ?? 0)} sem PDF (passo ${passoFaturas})` },
            ].map((m) => (
              <div key={m.rotulo} className="bg-white rounded-xl border border-[#e8eaed] px-4 py-3">
                <p className="text-[12px] text-[#6b7280]">{m.rotulo}</p>
                <p className={`text-[20px] font-bold tabular-nums leading-tight mt-0.5 ${m.cor}`}>{m.valor}</p>
                <p className="text-[11px] text-[#9ca3af] mt-1">{m.nota}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl border border-[#e8eaed]">
          <Passo n={1} titulo="Bancos importados" estado={fora.length ? "aviso" : configuradas.length ? "ok" : "pendente"}
            status={<>{n(configuradas.length)} conta(s){ateMin ? ` · sincronizadas até ${br(ateMin)}` : ""}{fora.length ? ` · ${fora.length} fora do sync` : ""}</>}
            acao={<button className={btn} onClick={() => alternar("contas")}>{aberto.contas ? "Ocultar contas" : "Ver contas"}</button>}>
            {(aberto.contas || data?.bloqueado) && (
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[#9ca3af]"><th className="py-1.5 font-semibold">Conta</th><th className="font-semibold">Sincronizada até</th><th className="font-semibold">Meta no mês</th><th className="font-semibold text-right">Situação</th></tr></thead>
                <tbody className="divide-y divide-[#f3f4f6]">
                  {contas.map((c) => (
                    <tr key={c.id}>
                      <td className="py-1.5 text-[#374151]">{c.banco} · <span className="text-[#6b7280]">{c.nome}</span></td>
                      <td className="tabular-nums text-[#6b7280]">{br(c.sincronizadaAte)}</td>
                      <td className="tabular-nums text-[#6b7280]">{n(c.cobrancasMetaNoMes)}</td>
                      <td className="text-right text-[12px]">
                        {c.manual ? <span className="text-[#9ca3af]">planilha</span>
                          : !c.temChave ? <span className="text-amber-600">sem chave</span>
                          : !c.configurada ? <span className="text-amber-600">nunca sincronizada</span>
                          : <span className="text-[#9ca3af]">ok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {aberto.contas && <p className="mt-2 text-[12px] text-[#9ca3af]">Sincronizar é na aba <Link href="/accounts" className="text-[#00a896] hover:underline">Accounts</Link>.</p>}
          </Passo>

          {!data?.bloqueado && (
            <>
              <Passo n={2} titulo="Códigos Revolut (CSV)" estado={faltaCsv.length ? "aviso" : total ? "ok" : "pendente"}
                status={faltaCsv.length ? <>falta o CSV de {faltaCsv.map((c) => `${c.nome} (${n(c.semCodigoNoMes)})`).join(" · ")}</> : "todas as cobranças Revolut com código"}
                acao={
                  <label className={`${btn} cursor-pointer`}>
                    <Upload className="w-3.5 h-3.5" />{busy === "csv" ? "Importando…" : "Subir CSV"}
                    <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ""; }} />
                  </label>
                } />

              {temMeta && (
                <Passo n={3} titulo="Conexão Meta (opcional)" estado={metaRuim.length ? "aviso" : "ok"}
                  status={<>{conectadas.map((m) => `${m.operacao}: ${m.valido ? `conectada${m.expiraEm ? ` até ${br(m.expiraEm)}` : ""}` : m.valido === false ? "expirada" : "não deu pra conferir"}`).join(" · ")} · {n(p?.meta.cobrancas ?? 0)} cobranças da Meta no mês (<Link href="/cobrancas-meta" className="text-[#00a896] hover:underline">sincronizar</Link>)</>}
                  acao={metaRuim.length > 0 && (
                    <button className={btn} onClick={() => window.open(`/api/meta/auth?operationId=${metaRuim[0].operationId}`, "conectar-meta", "width=640,height=760")}>
                      Reconectar{metaRuim.length > 1 ? ` (${metaRuim[0].operacao})` : ""}
                    </button>
                  )} />
              )}

              <Passo n={temMeta ? 4 : 3} titulo="Faturas PDF" estado={!total ? "pendente" : (pend?.codigoSemPdf ?? 0) === 0 && (pend?.semCodigo ?? 0) === 0 ? "ok" : comFatura ? "aviso" : "pendente"}
                status={(pend?.codigoSemPdf ?? 0) > 0 ? `${n(pend?.codigoSemPdf ?? 0)} com código e sem PDF` : total ? "todas as cobranças com código têm fatura" : "sem cobranças no mês"}
                acao={<button className={btn} onClick={() => alternar("pdfs")}>{aberto.pdfs ? "Fechar" : "Importar PDFs"}</button>}>
                {aberto.pdfs && <ReceiptsImporter month={month} onImported={recarregarTudo} />}
              </Passo>
            </>
          )}
        </div>

        {msg && (
          <div className={`rounded-xl border px-4 py-2.5 text-[13px] ${msg.tipo === "erro" ? "border-rose-200 bg-rose-50 text-rose-800" : msg.tipo === "aviso" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{msg.texto}</div>
        )}

        {!data?.bloqueado && (
          <div>
            <p className="text-[13px] font-semibold text-[#374151] mb-2">Importações deste mês</p>
            <div className="bg-white rounded-xl border border-[#e8eaed] divide-y divide-[#f3f4f6]">
              {(data?.importacoes ?? []).length === 0 && <p className="px-5 py-3 text-[13px] text-[#9ca3af]">Nenhuma importação registrada para {month || "este mês"}.</p>}
              {(data?.importacoes ?? []).map((i) => (
                <div key={i.id} className="flex items-center gap-4 px-5 py-2.5 text-[13px]">
                  <span className="w-24 shrink-0 tabular-nums text-[#9ca3af]">{hora(i.quando)}</span>
                  <span className="w-60 shrink-0 text-[#374151] truncate" title={i.arquivo ?? undefined}>{i.tipo === "csv_revolut" ? "CSV Revolut" : "Faturas PDF"}{i.arquivo ? ` · ${i.arquivo}` : ""}</span>
                  <span className="w-28 shrink-0 text-[#6b7280] truncate">{i.quem}</span>
                  <span className="flex-1 text-[#6b7280] min-w-0">{resultadoImportacao(i)}{i.de ? ` · ${brCurto(i.de)}–${brCurto(i.ate)}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!data?.bloqueado && cartoes.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e8eaed]">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#f3f4f6]">
              <div>
                <h2 className="text-[14px] font-semibold text-[#1a202c]">Cobranças por cartão</h2>
                <p className="text-[12px] text-[#9ca3af]">{n(cartoes.length)} cartões · clique num cartão pra ver as transações</p>
              </div>
              <a className={btn} href={qsCobrancas({ formato: "csv" })} download><Download className="w-3.5 h-3.5" />Exportar CSV do mês</a>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#9ca3af]">
                  <th className="pl-5 py-2 font-medium">Cartão</th>
                  <th className="py-2 font-medium text-right">Cobranças</th>
                  <th className="py-2 pl-6 font-medium">Checado</th>
                  <th className="py-2 pl-6 pr-5 font-medium">Pendente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f4f6]">
                {cartoes.map((c) => {
                  const pendente = c.semPdf + c.semCodigo;
                  const isAberto = cartaoAberto === c.chave;
                  const lista = transacoes[chaveCache(c.chave)];
                  return [
                    <tr key={c.chave} className="cursor-pointer hover:bg-[#f9fafb] align-top" onClick={() => abrirCartao(c.chave)}>
                      <td className="pl-5 py-2.5">
                        <div className="flex items-start gap-1.5">
                          {isAberto ? <ChevronDown className="w-4 h-4 mt-0.5 text-[#9ca3af] shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-[#9ca3af] shrink-0" />}
                          <div>
                            <p className="font-medium text-[#1a202c]">{nomeCartao(c)}</p>
                            <p className="text-[11px] text-[#9ca3af]">{c.banco} · {c.conta}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-[#374151]">{n(c.total)}</td>
                      <td className="py-2.5 pl-6 tabular-nums">
                        <p className={c.ok ? "text-emerald-700 font-medium" : "text-[#9ca3af]"}>{n(c.ok)}</p>
                        <p className="text-[11px] text-[#6b7280] whitespace-nowrap">{valores(c.valorOk)}</p>
                      </td>
                      <td className="py-2.5 pl-6 pr-5 tabular-nums">
                        <p className={pendente ? "text-amber-700 font-medium" : "text-[#9ca3af]"}>
                          {n(pendente)}
                          {pendente > 0 && <span className="ml-1.5 text-[11px] font-normal text-[#9ca3af]">({[c.semPdf ? `${n(c.semPdf)} sem PDF` : "", c.semCodigo ? `${n(c.semCodigo)} sem código` : ""].filter(Boolean).join(" · ")})</span>}
                        </p>
                        <p className="text-[11px] text-[#6b7280] whitespace-nowrap">{valores(c.valorPendente)}</p>
                      </td>
                    </tr>,
                    isAberto && (
                      <tr key={`${c.chave}-lista`}>
                        <td colSpan={4} className="bg-[#fafbfc] px-5 py-3">
                          {lista === "carregando" || lista === undefined ? <p className="text-[12px] text-[#9ca3af]">Carregando…</p>
                            : lista === "erro" ? <p className="text-[12px] text-rose-600">Não deu pra buscar as transações deste cartão.</p>
                            : (
                              <>
                                <div className="flex justify-end mb-2">
                                  <a className="text-[12px] text-[#00a896] hover:underline inline-flex items-center gap-1" href={qsCobrancas({ cartao: c.chave, formato: "csv" })} download>
                                    <Download className="w-3 h-3" />Exportar este cartão
                                  </a>
                                </div>
                                <table className="w-full text-[12px]">
                                  <tbody className="divide-y divide-[#f0f1f3]">
                                    {[...lista].sort((a, b) => Number(a.situacao === "ok") - Number(b.situacao === "ok")).map((t) => (
                                      <tr key={t.id}>
                                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-[#6b7280]">{br(t.data)}</td>
                                        <td className="py-1.5 pr-3 whitespace-nowrap"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SITUACAO[t.situacao].cor}`}>{SITUACAO[t.situacao].texto}</span></td>
                                        <td className="py-1.5 text-right whitespace-nowrap tabular-nums text-[#374151]">{dinheiro(t.valor, t.moeda)}</td>
                                        <td className="py-1.5 pl-4 w-32">{t.codigo ? <span className="font-mono text-[#374151]">{t.codigo}</span> : <span className="text-[#9ca3af]">—</span>}</td>
                                        <td className="py-1.5 pl-2 text-[#6b7280] truncate max-w-[220px]" title={t.contaAnuncioNome ?? t.descricao}>{t.contaAnuncioNome ?? t.descricao}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
