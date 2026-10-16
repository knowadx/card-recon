"use client";

import { useCallback, useEffect, useState } from "react";
import ReceiptsImporter from "@/components/receipts-importer";

type Passo = { feito: boolean };
type Conta = {
  id: string; nome: string; banco: string; empresa: string; moeda: string;
  manual: boolean; configurada: boolean; temChave: boolean; ultimaTransacao: string | null; cobrancasMetaNoMes: number;
};
type ConexaoMeta = { operationId: string; operacao: string; conectado: boolean; valido: boolean | null; expiraEm: string | null; erro: string | null };
type Pendente = { id: string; data: string; banco: string; conta: string; empresa: string; cartao: string | null; descricao: string; valor: number; moeda: string; codigo: string | null };
type Data = {
  mesesDisponiveis?: string[];
  companies?: { id: string; name: string }[];
  company?: string | null;
  month?: string | null;
  contas?: Conta[];
  metaConexoes?: ConexaoMeta[];
  pendentes?: { total: number; semCodigo: number; codigoSemPdf: number; limite: number; lista: Pendente[] };
  passos?: {
    bancos: Passo & { transacoesMeta: number };
    revolutCsv: Passo & { semCodigo: number };
    meta: Passo & { cobrancas: number };
    faturas: Passo & { comFatura: number; semFatura: number };
  };
  resultado?: { totalMeta: number; semFatura: number; comFatura: number };
};
type Msg = { tipo: "ok" | "aviso" | "erro"; linhas: string[] };
type Opcao = { id: string | null; label: string; entity?: string };
type Config = { conta: Conta; opcoes: Opcao[] | null; escolha: string; erro?: string };
type J = Record<string, unknown>;

const br = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const lista = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const dinheiro = (v: number, moeda: string) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda}`;
const chave = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !["llc", "ltd", "ltda", "inc", "ou", "oy", "gmbh", "eireli"].includes(w)).join("");

// ── respostas das rotas → frases (nada de JSON na tela) ──────────────────────
/** Erro cru do banco → o que fazer. Mantém o original curto entre parênteses quando não reconhece. */
function erroBanco(e: unknown): string {
  const t = String(e ?? "");
  if (/\b401\b|no matching token|token inválido|unauthori[sz]ed/i.test(t)) return "o banco recusou a chave desta conta (401) — troque a chave";
  if (/\b403\b|forbidden|sem permiss/i.test(t)) return "a chave não tem permissão pra isso (403)";
  if (/\b429\b|rate limit|too many/i.test(t)) return "o banco pediu pra esperar (limite de chamadas) — tente de novo em alguns minutos";
  if (/\b50[0234]\b|timeout|fetch failed|econn/i.test(t)) return `o banco não respondeu agora — tente de novo (${t.slice(0, 60)})`;
  return t.length > 180 ? `${t.slice(0, 180)}…` : t;
}
function msgSync(j: J): Msg {
  const contas = (j.accounts as J[] | undefined) ?? [];
  const falhas = contas.filter((c) => c.error);
  const novas = contas.filter((c) => num(c.imported) > 0).map((c) => `${c.accountName}: ${num(c.imported)}`);
  const linhas = [`Bancos: ${num(j.imported)} transação(ões) nova(s) · ${num(j.skipped)} já existiam.`];
  if (novas.length) linhas.push(`Novas por conta — ${novas.join(" · ")}.`);
  for (const f of falhas) linhas.push(`⚠️ ${f.accountName}: ${erroBanco(f.error)}`);
  return { tipo: falhas.length ? "aviso" : "ok", linhas };
}
function msgSyncConta(nome: string, j: J): Msg {
  const ja = num(j.skipped ?? j.alreadyExisted);
  return { tipo: "ok", linhas: [`${nome}: ${num(j.imported)} transação(ões) nova(s)${ja ? ` · ${ja} já existiam` : ""}. Configurada — da próxima vez entra no "Sincronizar todas".`] };
}
function msgCsv(j: J): Msg {
  const linhas = [`CSV da Revolut: ${num(j.metaRefGravados)} código(s) gravado(s) · ${num(j.jaTinhamOMesmoCodigo)} já tinham.`];
  const falta = num(j.semTransacaoNoBanco);
  const gap = j.gapPeriodo as { de?: string; ate?: string } | null;
  if (falta) linhas.push(`⚠️ ${falta} cobrança(s) do CSV ainda não estão no banco${gap?.de ? ` (${br(gap.de.slice(0, 10))} a ${br(gap.ate?.slice(0, 10))})` : ""} — sincronize a Revolut no passo 1 e suba o CSV de novo.`);
  return { tipo: falta ? "aviso" : "ok", linhas };
}
function msgMeta(j: J): Msg {
  const linhas = [`Meta: ${num(j.charges)} cobrança(s) lida(s) · ${num(j.contasOk)} de ${num(j.contasTotal)} contas de anúncio.`];
  const semAcesso = lista(j.semAcesso), falharam = lista(j.falharam), gap = lista(j.accessGap);
  if (semAcesso.length) linhas.push(`⚠️ Sem acesso (precisa de permissão no Meta): ${semAcesso.join(", ")}.`);
  if (falharam.length) linhas.push(`⚠️ Falharam (rode de novo): ${falharam.join(", ")}.`);
  if (gap.length) linhas.push(`⚠️ BMs sem conta visível: ${gap.join(", ")}.`);
  return { tipo: semAcesso.length || falharam.length ? "aviso" : "ok", linhas };
}

export default function FechamentoPage() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState("");
  const [company, setCompany] = useState(""); // "" = todas as empresas do escopo
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [verTodas, setVerTodas] = useState(false);

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
  // voltou da janela do Meta (reconectar) → atualiza o status sem recarregar a página
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  /** Roda uma ação; a resposta vira frase (formatar) e a tela recarrega. */
  async function run(label: string, fn: () => Promise<Response>, formatar: (j: J) => Msg) {
    setBusy(label); setMsg(null);
    try {
      const r = await fn();
      const text = await r.text();
      let j: J | null = null;
      try { j = JSON.parse(text); } catch { /* não-JSON = tempo esgotado no caminho */ }
      if (!j) setMsg({ tipo: "aviso", linhas: [`⏱️ ${label}: demorou mais que o limite da conexão. O servidor segue trabalhando e o que já veio fica salvo — clique de novo daqui a pouco.`] });
      else if (!r.ok || j.ok === false || j.error) setMsg({ tipo: "erro", linhas: [`${label}: ${erroBanco(j.error ?? `erro ${r.status}`)}`] });
      else setMsg(formatar(j));
      reload();
    } catch (e) {
      setMsg({ tipo: "erro", linhas: [`${label}: ${(e as Error).message}`] });
    } finally { setBusy(null); }
  }
  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const syncTodas = () => run("Sincronizar todas", () => post("/api/sync/all", { company: company || undefined }), msgSync);
  const syncConta = (c: Conta) => run(`Sincronizar ${c.nome}`, () => post("/api/sync/all", { accountId: c.id }), msgSync);
  function syncMeta() {
    const [y, mo] = month.split("-").map(Number);
    const to = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
    return run("Sincronizar Meta", () => post("/api/meta/sync", { from: `${month}-01`, to }), msgMeta);
  }
  const onCsv = async (file: File) => run("CSV da Revolut", async () => fetch("/api/admin/import-revolut-csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() }), msgCsv);

  /** 1ª vez de uma conta: lista as opções do banco (sub-conta Mercury, perfil Wise, conta Revolut). */
  async function abrirConfig(c: Conta) {
    setConfig({ conta: c, opcoes: null, escolha: "" });
    const url = c.banco === "Mercury" ? `/api/sync/mercury/accounts?accountId=${c.id}` : c.banco === "Wise" ? `/api/sync/wise/accounts?accountId=${c.id}` : `/api/revolut/accounts?accountId=${c.id}`;
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || !Array.isArray(j)) throw new Error((j as J)?.error ? String((j as J).error) : `erro ${r.status}`);
      let opcoes: Opcao[];
      if (c.banco === "Mercury") opcoes = (j as J[]).map((a) => ({ id: String(a.id), label: `${a.name ?? a.id}${a.kind ? ` (${a.kind})` : ""}`, entity: a.entity ? String(a.entity) : undefined }));
      else if (c.banco === "Wise") opcoes = (j as J[]).map((p) => ({ id: String(p.id), label: String(p.label) }));
      else opcoes = [{ id: null, label: "Todas as contas da empresa" }, ...(j as J[]).map((a) => ({ id: String(a.id), label: `${a.name ?? a.id} ${a.currency ?? ""}`.trim() }))];
      // Wise: já deixa escolhido o perfil com o nome da empresa (o servidor recusa outro)
      const sugestao = c.banco === "Wise" ? opcoes.find((o) => chave(o.label) === chave(c.empresa))?.id ?? "" : opcoes[0]?.id ?? "";
      setConfig({ conta: c, opcoes, escolha: sugestao ?? "" });
    } catch (e) {
      setConfig({ conta: c, opcoes: [], escolha: "", erro: c.banco === "Revolut" ? "configurar a Revolut é com o administrador geral" : erroBanco((e as Error).message) });
    }
  }
  function confirmarConfig() {
    if (!config) return;
    const { conta, escolha, opcoes } = config;
    const op = opcoes?.find((o) => (o.id ?? "") === escolha);
    const body =
      conta.banco === "Mercury" ? { accountId: conta.id, mercuryAccountId: escolha, entity: op?.entity }
      : conta.banco === "Wise" ? { accountId: conta.id, profileId: escolha }
      : { accountId: conta.id, revolutAccountId: escolha || null };
    setConfig(null);
    return run(`Configurar ${conta.nome}`, () => post(`/api/sync/${conta.banco.toLowerCase()}`, body), (j) => msgSyncConta(conta.nome, j));
  }

  const p = data?.passos;
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
  const btnSm = "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50";
  const msgCor = msg?.tipo === "erro" ? "border-red-200 bg-red-50 text-red-800" : msg?.tipo === "aviso" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  const pend = data?.pendentes;
  const mostradas = verTodas ? pend?.lista ?? [] : (pend?.lista ?? []).slice(0, 30);

  return (
    <div className="flex flex-col gap-4 p-2 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Fechamento Meta do mês</h1>
          <p className="text-sm text-slate-700 mb-1"><strong>Só cobranças da Meta (Facebook):</strong> confere cada cobrança da Meta no extrato dos bancos contra a fatura (PDF) da Meta. A Meta cobra várias vezes por dia — por isso este fechamento existe. Outras despesas e receitas <strong>não</strong> entram aqui.</p>
          <p className="text-sm text-slate-500">Passos na ordem, de cima pra baixo — tudo nesta tela. Escopo: <strong>{company ? (data?.companies?.find((c) => c.id === company)?.name ?? "empresa") : "todas as empresas"}</strong> · <strong>{month || "—"}</strong>. O PDF importa <strong>só o mês selecionado</strong> — não mexe nos outros.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">empresa
            <select className="rounded-md border border-slate-300 px-2 py-1 text-sm max-w-[200px]" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Todas</option>
              {(data?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">mês
            <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
              {(data?.mesesDisponiveis ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </div>

      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm ${msgCor}`}>
          {msg.linhas.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      <Step n={1} title="Bancos (Wise / Revolut / Mercury)" feito={p?.bancos.feito} status={`${p?.bancos.transacoesMeta ?? 0} cobranças Meta no extrato de ${month || "—"}`}>
        <div className="flex flex-col gap-2">
          <div><button className={btn} disabled={busy !== null} onClick={syncTodas}>{busy === "Sincronizar todas" ? "Sincronizando…" : "Sincronizar todas"}</button>
            <span className="ml-2 text-xs text-slate-400">as já configuradas; as outras, uma a uma abaixo</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th className="py-1 font-medium">Conta</th><th className="font-medium">Dados até</th><th className="font-medium">Meta no mês</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.contas ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5"><span className="text-slate-800">{c.banco}</span> <span className="text-slate-500">· {c.nome}</span></td>
                  <td className="tabular-nums text-slate-600">{br(c.ultimaTransacao)}</td>
                  <td className="tabular-nums text-slate-600">{c.cobrancasMetaNoMes}</td>
                  <td className="text-right">
                    {c.manual ? <span className="text-xs text-slate-400">planilha (manual)</span>
                      : !c.temChave ? <span className="text-xs text-amber-700">sem chave do banco</span>
                      : c.configurada ? <button className={btnSm} disabled={busy !== null} onClick={() => syncConta(c)}>{busy === `Sincronizar ${c.nome}` ? "Sincronizando…" : "Sincronizar"}</button>
                      : <button className={btnSm} disabled={busy !== null} onClick={() => abrirConfig(c)}>Configurar e sincronizar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {config && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm flex flex-col gap-2">
              <div className="font-medium text-slate-700">1ª sincronização: {config.conta.banco} · {config.conta.nome}</div>
              {config.erro ? <div className="text-red-700">{config.erro}</div>
                : config.opcoes === null ? <div className="text-slate-500">Buscando no banco…</div>
                : config.opcoes.length === 0 ? <div className="text-red-700">O banco não devolveu nenhuma opção para esta chave.</div>
                : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">{config.conta.banco === "Wise" ? "Perfil:" : "Conta no banco:"}</span>
                    <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={config.escolha} onChange={(e) => setConfig({ ...config, escolha: e.target.value })}>
                      {config.conta.banco === "Wise" && <option value="">— escolha —</option>}
                      {config.opcoes.map((o) => <option key={o.id ?? "todas"} value={o.id ?? ""}>{o.label}</option>)}
                    </select>
                    <button className={btnSm} disabled={busy !== null || (config.conta.banco !== "Revolut" && !config.escolha)} onClick={confirmarConfig}>Sincronizar</button>
                    {config.conta.banco === "Wise" && <span className="text-xs text-slate-400">só aceita o perfil com o nome da empresa ({config.conta.empresa})</span>}
                  </div>
                )}
              <button className="self-start text-xs text-slate-500 hover:underline" onClick={() => setConfig(null)}>cancelar</button>
            </div>
          )}
        </div>
      </Step>

      <Step n={2} title="Código Revolut (CSV do mês)" feito={p?.revolutCsv.feito} status={p && p.revolutCsv.semCodigo > 0 ? `${p.revolutCsv.semCodigo} cobranças Revolut sem código` : "todas com código"}>
        <label className={btn + " cursor-pointer inline-block"}>
          {busy === "CSV da Revolut" ? "Importando…" : "Subir CSV da Revolut"}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ""; }} />
        </label>
        <span className="ml-2 text-xs text-slate-400">a API da Revolut não manda o código “Facebk *…” — ele vem do extrato em CSV</span>
      </Step>

      <Step n={3} title="Cobranças Meta (só este mês)" feito={p?.meta.feito} status={`${p?.meta.cobrancas ?? 0} cobranças do Meta`}>
        <div className="flex flex-col gap-2">
          {(data?.metaConexoes ?? []).length === 0 && <div className="text-xs text-slate-400">Nenhuma operação no seu escopo.</div>}
          {(data?.metaConexoes ?? []).map((m) => (
            <div key={m.operationId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-800">{m.operacao}:</span>
              {!m.conectado ? <span className="text-amber-700">não conectado</span>
                : m.valido ? <span className="text-emerald-700">conectado{m.expiraEm ? ` (vale até ${br(m.expiraEm)})` : ""}</span>
                : m.valido === false ? <span className="text-red-700">expirado/inválido — {m.erro}</span>
                : <span className="text-slate-500">não deu pra conferir ({m.erro})</span>}
              {m.valido !== true && (
                <button className={btnSm} onClick={() => window.open(`/api/meta/auth?operationId=${m.operationId}`, "conectar-meta", "width=640,height=760")}>
                  {m.conectado ? "Reconectar Meta" : "Conectar Meta"}
                </button>
              )}
            </div>
          ))}
          <div><button className={btn} disabled={busy !== null || !month} onClick={syncMeta}>{busy === "Sincronizar Meta" ? "Sincronizando…" : "Sincronizar Meta"}</button></div>
        </div>
      </Step>

      <Step n={4} title="Faturas (PDFs) — por último" feito={p?.faturas.feito} status={p && p.faturas.semFatura > 0 ? `${p.faturas.semFatura} sem fatura 🔴 · ${p.faturas.comFatura} com fatura` : `${p?.faturas.comFatura ?? 0} com fatura`}>
        <ReceiptsImporter month={month} onImported={reload} />
      </Step>

      {data?.resultado && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
          <div className="text-sm">
            <div className="text-slate-500 text-xs">Resultado de {month}</div>
            <div className="mt-1"><strong>{data.resultado.totalMeta}</strong> cobranças Meta · <strong className={data.resultado.semFatura > 0 ? "text-red-600" : "text-emerald-600"}>{data.resultado.semFatura} sem fatura {data.resultado.semFatura > 0 ? "🔴" : "✓"}</strong>
              {pend && pend.total > 0 && <span className="text-slate-500"> — {pend.semCodigo} sem código (passo 2) · {pend.codigoSemPdf} com código mas sem PDF (passo 4)</span>}
            </div>
          </div>
          {pend && pend.lista.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-400"><th className="py-1 font-medium">Data</th><th className="font-medium">Conta</th><th className="font-medium">Cartão</th><th className="font-medium text-right">Valor</th><th className="font-medium pl-3">Código</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {mostradas.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1 tabular-nums text-slate-600">{br(t.data)}</td>
                      <td className="text-slate-700">{t.banco} · {t.conta}</td>
                      <td className="text-slate-500">{t.cartao ?? "—"}</td>
                      <td className="text-right tabular-nums text-slate-800">{dinheiro(t.valor, t.moeda)}</td>
                      <td className="pl-3">{t.codigo ? <span className="font-mono text-slate-700">{t.codigo}</span> : <span className="text-amber-700">sem código</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                <span>mostrando {mostradas.length} de {pend.total}{pend.total > pend.limite ? ` (a lista traz no máximo ${pend.limite})` : ""}</span>
                {pend.lista.length > mostradas.length && <button className="text-indigo-600 hover:underline" onClick={() => setVerTodas(true)}>mostrar todas</button>}
                {verTodas && pend.lista.length > 30 && <button className="text-indigo-600 hover:underline" onClick={() => setVerTodas(false)}>mostrar menos</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step({ n, title, feito, status, children }: { n: number; title: string; feito?: boolean; status: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${feito ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{feito ? "✓" : n}</span>
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-800">{title}</div>
          <div className={`text-xs ${feito ? "text-emerald-600" : "text-slate-400"}`}>{status}</div>
        </div>
      </div>
      <div className="pl-9">{children}</div>
    </div>
  );
}
