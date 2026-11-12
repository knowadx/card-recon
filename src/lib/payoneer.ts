import { createHash } from "crypto";

/**
 * Leitura do CSV do Payoneer (pedido do dono em 2026-11-12: "conectar contas Payoneer via CSV"). Formato =
 * o relatório de movimentação por saldo (o dono mandou um primeiro arquivo e corrigiu: "errei o formato"):
 *   Currency,Payout method,Transaction date,Transaction time,Time zone,Credit amount,Debit amount,Status,Running balance,Description
 *   EUR,EUR balance,12-31-2025,12:51:50,UTC,0,-133.8,Completed,30359.33,Card charge (FACEBK *S5THJA9WR2)
 * - data MM-DD-AAAA + hora + fuso (UTC → instante exato; outro fuso → meio-dia UTC do dia, sem chutar a hora);
 * - valor = crédito + débito (o débito já vem negativo); moeda da linha (um arquivo pode ter EUR e USD);
 * - só entra Status "Completed";
 * - SEM id por lançamento → chave = moeda + data/hora + valor + descrição (o FACEBK *código é único) + ordem de
 *   ocorrência (duas linhas idênticas no mesmo segundo seguem separadas) — reimportar não duplica;
 * - "Running balance" confere a SEQUÊNCIA por moeda: saldo da linha = saldo da anterior + valor; quebra =
 *   falta lançamento no arquivo (avisado na tela);
 * - o arquivo não diz o período que cobre → a tela pergunta (src/lib/importacaoArquivo.ts).
 */
export type LancamentoPayoneer = { chave: string; data: Date; descricao: string; valor: number; moeda: string };
export type ExtratoPayoneer = { lancamentos: LancamentoPayoneer[]; naoConcluidos: number; invalidos: number; quebrasDeSaldo: number };

const COLUNAS = ["currency", "transaction date", "transaction time", "credit amount", "debit amount", "status", "running balance", "description"];

/** Uma linha de CSV com aspas (vírgula dentro de aspas não separa; "" = aspa). */
function campos(linha: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === "," && !aspas) {
      out.push(atual); atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out.map((x) => x.trim());
}

/** "12-31-2025" + "12:51:50" + "UTC" → instante; fuso que não é UTC → meio-dia UTC do dia; inválida → null. */
export function dataPayoneer(dia: string, hora: string, fuso: string): Date | null {
  const m = dia.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return null;
  const [, mes, d, ano] = m;
  const base = `${ano}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const h = hora.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const utc = !fuso.trim() || /^(utc|gmt|z)$/i.test(fuso.trim());
  const iso = h && utc ? `${base}T${h[1].padStart(2, "0")}:${h[2]}:${h[3] ?? "00"}.000Z` : `${base}T12:00:00.000Z`;
  const data = new Date(iso);
  // 02-31 vira 03-03 no Date: confere que o dia não "andou"
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== base ? null : data;
}

/** "-133.8", "1,234.50", "" → número (vazio = 0); inválido → null. */
export function valorPayoneer(bruto: string): number | null {
  const t = bruto.replace(/[\s,]/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const centavos = (x: number) => Math.round(x * 100);

export function lerPayoneer(texto: string): { extrato?: ExtratoPayoneer; erro?: string } {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { erro: "arquivo vazio" };
  const cab = campos(linhas[0]).map((c) => c.toLowerCase());
  const faltam = COLUNAS.filter((c) => !cab.includes(c));
  if (faltam.length) {
    return { erro: `não parece o CSV de movimentação do Payoneer — faltam as colunas ${faltam.join(", ")} (veio: ${campos(linhas[0]).join(", ")})` };
  }
  const i = (nome: string) => cab.indexOf(nome);

  type Linha = LancamentoPayoneer & { saldo: number | null; base: string };
  const lidas: Linha[] = [];
  let naoConcluidos = 0, invalidos = 0;
  for (const linha of linhas.slice(1)) {
    const c = campos(linha);
    if ((c[i("status")] ?? "").toLowerCase() !== "completed") { naoConcluidos++; continue; }
    const data = dataPayoneer(c[i("transaction date")] ?? "", c[i("transaction time")] ?? "", i("time zone") >= 0 ? c[i("time zone")] ?? "" : "UTC");
    const credito = valorPayoneer(c[i("credit amount")] ?? "");
    const debito = valorPayoneer(c[i("debit amount")] ?? "");
    const moeda = (c[i("currency")] ?? "").toUpperCase();
    if (!data || credito === null || debito === null || !moeda) { invalidos++; continue; }
    const valor = (Math.abs(credito) - Math.abs(debito));
    const descricao = (c[i("description")] ?? "").trim() || "Payoneer";
    const saldo = valorPayoneer(c[i("running balance")] ?? "");
    const base = `${moeda}:${data.toISOString()}:${valor.toFixed(2)}:${createHash("sha1").update(descricao).digest("hex").slice(0, 12)}`;
    lidas.push({ chave: "", data, descricao, valor, moeda, saldo: c[i("running balance")]?.trim() ? saldo : null, base });
  }
  if (!lidas.length) return { erro: naoConcluidos ? `nenhum lançamento concluído (${naoConcluidos} não concluído(s))` : "nenhum lançamento válido no arquivo" };

  // chave: base + ordem de ocorrência (1ª, 2ª… da mesma moeda/hora/valor/descrição)
  const ocorrencias = new Map<string, number>();
  for (const l of lidas) {
    const n = (ocorrencias.get(l.base) ?? 0) + 1;
    ocorrencias.set(l.base, n);
    l.chave = `${l.base}:${n}`;
  }

  // sequência do saldo por moeda, do mais antigo pro mais novo (mesmo instante: a ordem do arquivo, invertida)
  let quebrasDeSaldo = 0;
  const porMoeda = new Map<string, Linha[]>();
  lidas.forEach((l) => porMoeda.set(l.moeda, [...(porMoeda.get(l.moeda) ?? []), l]));
  for (const lista of porMoeda.values()) {
    const ord = lista.map((l, k) => ({ l, k })).sort((a, b) => a.l.data.getTime() - b.l.data.getTime() || b.k - a.k).map((x) => x.l);
    for (let k = 1; k < ord.length; k++) {
      const antes = ord[k - 1].saldo, agora = ord[k].saldo;
      if (antes !== null && agora !== null && centavos(antes + ord[k].valor) !== centavos(agora)) quebrasDeSaldo++;
    }
  }

  return { extrato: { lancamentos: lidas.map(({ chave, data, descricao, valor, moeda }) => ({ chave, data, descricao, valor, moeda })), naoConcluidos, invalidos, quebrasDeSaldo } };
}
