/**
 * Leitura do CSV do Payoneer (pedido do dono em 2026-11-12: "conectar contas Payoneer via CSV"). Formato =
 * o extrato COMPLETO, com Transaction ID (o dono testou 3 exportações e escolheu esta: "tem transaction ID e
 * já vem com a info de facebk que precisamos na descrição"):
 *   Transaction Date,Transaction Time,Time Zone,Transaction ID,Description,Credit Amount,Debit Amount,Currency,
 *   Transfer Amount,Transfer Amount Currency,Status,Running Balance,Additional Description,Store Name,Source,Target,Reference ID
 *   11/08/2026,03:00:16,UTC,1058836869,Payment to …,,18070.48,USD,,,Completed,3057.59,Loan payment,,USD balance,…,
 * - data MM/DD/AAAA + hora + fuso (UTC → instante exato; outro fuso → meio-dia UTC do dia, sem chutar a hora);
 * - valor = crédito − débito (o débito vem POSITIVO neste formato; o sinal é ignorado); moeda da linha;
 * - Transaction ID = chave do lançamento (reimportar não duplica) — só UM formato aceito: outro formato
 *   geraria outra chave pro mesmo lançamento (duplicaria). Crédito depositado pelo Payoneer vem SEM Transaction
 *   ID (dono, 2026-11-13: "o arquivo não importa e esse campo fica vazio") → chave pelos fatos da linha que não
 *   mudam: instante + valor + moeda + saldo depois dela ("sem-id:…");
 * - descrição = Description + Store Name + Additional Description (o FACEBK *código pode vir em qualquer uma);
 * - só entra Status "Completed";
 * - "Running Balance" confere a SEQUÊNCIA por moeda: saldo da linha = saldo da anterior + valor; quebra = falta
 *   lançamento no arquivo (avisado na tela);
 * - o arquivo não diz o período que cobre → a tela pergunta (src/lib/importacaoArquivo.ts).
 */
export type LancamentoPayoneer = { chave: string; data: Date; descricao: string; valor: number; moeda: string };
export type ExtratoPayoneer = { lancamentos: LancamentoPayoneer[]; naoConcluidos: number; invalidos: number; quebrasDeSaldo: number };

const COLUNAS = ["transaction date", "transaction time", "transaction id", "description", "credit amount", "debit amount", "currency", "status", "running balance"];

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

/** "11/08/2026" + "03:00:16" + "UTC" → instante; fuso que não é UTC → meio-dia UTC do dia; inválida → null. */
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

/** "18070.48", "1,234.50", "-5" → número (vazio = 0); inválido → null. */
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
    return { erro: `não parece o extrato completo do Payoneer (o que tem Transaction ID) — faltam as colunas ${faltam.join(", ")} (veio: ${campos(linhas[0]).join(", ")})` };
  }
  const i = (nome: string) => cab.indexOf(nome);
  const col = (c: string[], nome: string) => (i(nome) >= 0 ? c[i(nome)] ?? "" : "").trim();

  type Linha = LancamentoPayoneer & { saldo: number | null; ordem: number };
  const lidas: Linha[] = [];
  const vistas = new Set<string>();
  let naoConcluidos = 0, invalidos = 0;
  for (const [ordem, linha] of linhas.slice(1).entries()) {
    const c = campos(linha);
    if (col(c, "status").toLowerCase() !== "completed") { naoConcluidos++; continue; }
    const data = dataPayoneer(col(c, "transaction date"), col(c, "transaction time"), i("time zone") >= 0 ? col(c, "time zone") : "UTC");
    const credito = valorPayoneer(col(c, "credit amount"));
    const debito = valorPayoneer(col(c, "debit amount"));
    const moeda = col(c, "currency").toUpperCase();
    if (!data || credito === null || debito === null || !moeda) { invalidos++; continue; }
    const valor = Math.abs(credito) - Math.abs(debito);
    const saldoBruto = col(c, "running balance");
    const saldo = saldoBruto ? valorPayoneer(saldoBruto) : null;
    let chave = col(c, "transaction id");
    if (!chave) {
      const base = `sem-id:${data.toISOString()}:${centavos(valor)}:${moeda}:${saldo === null ? "" : centavos(saldo)}`;
      chave = base;
      for (let n = 2; vistas.has(chave); n++) chave = `${base}:${n}`; // linhas idênticas no mesmo arquivo
    }
    if (vistas.has(chave)) { invalidos++; continue; } // Transaction ID repetido no arquivo
    vistas.add(chave);
    const descricao = [col(c, "description"), col(c, "store name"), col(c, "additional description")]
      .filter((x, k, arr) => x && arr.indexOf(x) === k).join(" — ") || "Payoneer";
    lidas.push({ chave, data, descricao, valor, moeda, saldo, ordem });
  }
  if (linhas.length === 1) return { erro: "o extrato não tem nenhum lançamento — se a conta não teve movimento no período, use \"Marcar sem movimentação\" no mês" };
  if (!lidas.length) return { erro: naoConcluidos ? `nenhum lançamento concluído (${naoConcluidos} não concluído(s))` : "nenhum lançamento válido no arquivo" };

  // sequência do saldo por moeda, do mais antigo pro mais novo (mesmo instante: a ordem do arquivo, invertida)
  let quebrasDeSaldo = 0;
  const porMoeda = new Map<string, Linha[]>();
  lidas.forEach((l) => porMoeda.set(l.moeda, [...(porMoeda.get(l.moeda) ?? []), l]));
  for (const lista of porMoeda.values()) {
    const ord = [...lista].sort((a, b) => a.data.getTime() - b.data.getTime() || b.ordem - a.ordem);
    for (let k = 1; k < ord.length; k++) {
      const antes = ord[k - 1].saldo, agora = ord[k].saldo;
      if (antes !== null && agora !== null && centavos(antes + ord[k].valor) !== centavos(agora)) quebrasDeSaldo++;
    }
  }

  return { extrato: { lancamentos: lidas.map(({ chave, data, descricao, valor, moeda }) => ({ chave, data, descricao, valor, moeda })), naoConcluidos, invalidos, quebrasDeSaldo } };
}
