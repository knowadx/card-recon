import { prisma } from "./db";
import { camposCsv } from "./csvLinha";

/**
 * Husky em CSV (dono, 2026-11-13: "a Husky agora faz exportação de CSV"). Formato visto no arquivo dele:
 *   Payer Name,<empresa>            ← cabeçalho de quem é o extrato
 *   Account Type,Payer
 *   date,event,currency,amount,fullname,document,email,feeBearer,feeRate,marketRate,payoutAmount,trackingCode
 *   2026-10-02T02:42:05.638Z,DEBIT,BRL,-574.17,<beneficiário>,…,payer,0,5.2249,3000.00,
 * - date = instante exato (UTC, com milissegundos);
 * - amount = valor na MOEDA DA CONTA (USD), com sinal; currency/payoutAmount = o que o beneficiário recebeu
 *   (3000 BRL ÷ 5.2249 = 574.17 — conferido nas linhas do arquivo dele);
 * - descrição = evento · beneficiário (+ "3000.00 BRL" quando o pagamento saiu em outra moeda); e-mail e
 *   documento não entram;
 * - chave = husky:csv:<instante>:<centavos> (repetidas numeradas — src/lib/chaveRepetida.ts).
 * A planilha (XLS) descreve os MESMOS lançamentos de outro jeito ("Payout 1293890", "Provisioned payout…") e
 * não dá pra casar linha a linha → um formato só por período em cada conta (conflitoDeFormato).
 */
export type LancamentoHusky = { chave: string; data: Date; descricao: string; valor: number };

const sem = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** O extrato é desta empresa? (nomes normalizados: um contém o outro). Sem nome no arquivo = não dá pra dizer. */
export function mesmaEmpresa(doArquivo: string | null, daConta: string): boolean {
  if (!doArquivo) return true;
  const a = sem(doArquivo), b = sem(daConta);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

export function lerHuskyCsv(texto: string, moedaDaConta: string): { pagador: string | null; lancamentos: LancamentoHusky[]; invalidos: number } | { erro: string } {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const iCab = linhas.findIndex((l) => { const c = camposCsv(l).map((x) => x.toLowerCase()); return c.includes("date") && c.includes("amount") && c.includes("event"); });
  if (iCab < 0) return { erro: "não parece o CSV da Husky — falta a linha de colunas (date, event, amount…)" };
  let pagador: string | null = null;
  for (const l of linhas.slice(0, iCab)) {
    const [k, v] = camposCsv(l);
    if (k?.toLowerCase() === "payer name" && v) pagador = v;
  }
  const cab = camposCsv(linhas[iCab]).map((x) => x.toLowerCase());
  const col = (c: string[], nome: string) => (cab.indexOf(nome) >= 0 ? c[cab.indexOf(nome)] ?? "" : "").trim();

  const lancamentos: LancamentoHusky[] = [];
  let invalidos = 0;
  for (const l of linhas.slice(iCab + 1)) {
    const c = camposCsv(l);
    const data = new Date(col(c, "date"));
    const valor = Number(col(c, "amount").replace(/,/g, ""));
    if (!col(c, "date") || Number.isNaN(data.getTime()) || !Number.isFinite(valor) || valor === 0) { invalidos++; continue; }
    const moeda = col(c, "currency").toUpperCase();
    const pago = col(c, "payoutamount");
    const descricao = [col(c, "event"), col(c, "fullname"), moeda && moeda !== moedaDaConta.toUpperCase() && pago ? `${pago} ${moeda}` : ""]
      .filter(Boolean).join(" · ") || "Husky";
    lancamentos.push({ chave: `csv:${data.toISOString()}:${Math.round(valor * 100)}`, data, descricao, valor });
  }
  if (!lancamentos.length) return { erro: "o CSV da Husky não tem nenhum lançamento — se a conta não teve movimento no período, use \"Marcar sem movimentação\" no mês" };
  return { pagador, lancamentos, invalidos };
}

/**
 * Um formato só por período em cada conta: importar CSV onde a planilha (XLS) já tem lançamento (ou o contrário)
 * duplicaria — os dois descrevem o mesmo pagamento de jeitos diferentes. Margem de 1 dia (a planilha só tem o dia).
 * Devolve a mensagem de recusa, ou null.
 */
export async function conflitoDeFormato(accountId: string, formato: "csv" | "xls", datas: Date[]): Promise<string | null> {
  if (!datas.length) return null;
  const t = datas.map((d) => d.getTime());
  const de = new Date(Math.min(...t) - 86_400_000), ate = new Date(Math.max(...t) + 86_400_000);
  const outro = formato === "csv"
    ? { reference: { startsWith: "husky:" }, NOT: { reference: { startsWith: "husky:csv:" } } }
    : { reference: { startsWith: "husky:csv:" } };
  const achados = await prisma.transaction.aggregate({ where: { accountId, date: { gte: de, lte: ate }, ...outro }, _count: true, _min: { date: true }, _max: { date: true } });
  if (!achados._count) return null;
  const br = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "?");
  const nome = formato === "csv" ? "pela planilha (XLS)" : "pelo CSV";
  return `esta conta já tem ${achados._count} lançamento(s) importado(s) ${nome} entre ${br(achados._min.date)} e ${br(achados._max.date)} — o mesmo período não entra pelos dois formatos (duplicaria). Exporte a partir do dia seguinte ao último importado`;
}
