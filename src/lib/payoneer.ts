/**
 * Leitura do CSV exportado do Payoneer (pedido do dono em 2026-11-12: "conectar contas Payoneer via CSV").
 * Formato medido no arquivo real da Pixel Ads:
 *   Date,Description,Amount,Currency,Status,Transaction ID
 *   "07 Nov, 2026",Payment to …,"-18,070.48",USD,Completed,1058836869<TAB e espaços>
 * - data "DD Mon, AAAA" (mês em inglês), sem hora → meio-dia UTC (o dia não muda em fuso nenhum do Brasil);
 * - valor com vírgula de milhar, ponto decimal e sinal;
 * - Transaction ID = chave do lançamento (reimportar não duplica);
 * - só entra Status "Completed" — o resto (pendente, falhou…) é contado e fica de fora;
 * - o arquivo NÃO diz o período que cobre → a tela pergunta (src/lib/importacaoArquivo.ts).
 */
export type LancamentoPayoneer = { id: string; data: Date; descricao: string; valor: number; moeda: string };
export type ExtratoPayoneer = { lancamentos: LancamentoPayoneer[]; naoConcluidos: number; invalidos: number };

const MESES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

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

/** "07 Nov, 2026" (ou "Nov 07, 2026", ou AAAA-MM-DD) → meio-dia UTC daquele dia; inválida → null. */
export function dataPayoneer(bruto: string): Date | null {
  const t = bruto.trim();
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})$/);
  let dia: string | undefined, mes: string | undefined, ano: string | undefined;
  if (m) { [, dia, mes, ano] = m; mes = MESES[mes.toLowerCase()]; }
  else if ((m = t.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/))) { [, mes, dia, ano] = m; mes = MESES[mes.toLowerCase()]; }
  else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) { [, ano, mes, dia] = m; }
  if (!dia || !mes || !ano) return null;
  const d = new Date(`${ano}-${mes}-${dia.padStart(2, "0")}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "-18,070.48" → -18070.48; inválido → null. */
export function valorPayoneer(bruto: string): number | null {
  const n = Number(bruto.replace(/[\s,]/g, ""));
  return bruto.trim() && Number.isFinite(n) ? n : null;
}

export function lerPayoneer(texto: string): { extrato?: ExtratoPayoneer; erro?: string } {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { erro: "arquivo vazio" };
  const cab = campos(linhas[0]).map((c) => c.toLowerCase());
  const col = (nome: string) => cab.indexOf(nome);
  const iData = col("date"), iDesc = col("description"), iValor = col("amount"), iMoeda = col("currency"), iStatus = col("status"), iId = col("transaction id");
  if ([iData, iDesc, iValor, iId].some((i) => i < 0)) {
    return { erro: `não parece o CSV do Payoneer — faltam colunas (esperado: Date, Description, Amount, Currency, Status, Transaction ID; veio: ${campos(linhas[0]).join(", ")})` };
  }
  const lancamentos: LancamentoPayoneer[] = [];
  let naoConcluidos = 0, invalidos = 0;
  for (const linha of linhas.slice(1)) {
    const c = campos(linha);
    if (iStatus >= 0 && (c[iStatus] ?? "").toLowerCase() !== "completed") { naoConcluidos++; continue; }
    const data = dataPayoneer(c[iData] ?? "");
    const valor = valorPayoneer(c[iValor] ?? "");
    const id = (c[iId] ?? "").trim();
    if (!data || valor === null || !id) { invalidos++; continue; }
    lancamentos.push({ id, data, descricao: (c[iDesc] ?? "").trim() || "Payoneer", valor, moeda: (iMoeda >= 0 ? c[iMoeda] : "")?.trim().toUpperCase() || "" });
  }
  if (!lancamentos.length) return { erro: naoConcluidos ? `nenhum lançamento concluído (${naoConcluidos} não concluído(s))` : "nenhum lançamento válido no arquivo" };
  return { extrato: { lancamentos, naoConcluidos, invalidos } };
}
