import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { transactionScope, type AppUser } from "@/lib/access";

/**
 * Cobranças da Meta de um mês, vistas pelo EXTRATO — fonte única do Fechamento: o resumo por cartão,
 * as transações de um cartão e a exportação leem daqui, com o mesmo escopo (pedido do dono em
 * 2026-10-17: "Total por Cartão (ok e pendente) · dropdown de cartão · exportar").
 *
 * Situação de cada cobrança (mesma regra de src/lib/receipts.ts):
 *  - "ok": o código do extrato (metaRef) bate com uma fatura PDF salva (hasReceipt);
 *  - "sem_pdf": tem código, mas a fatura não foi importada;
 *  - "sem_codigo": sem código no extrato (Revolut sem o CSV do mês).
 */
export type Situacao = "ok" | "sem_pdf" | "sem_codigo";

export type CobrancaMeta = {
  id: string;
  data: string; // AAAA-MM-DD
  empresa: string;
  banco: string;
  contaId: string;
  conta: string;
  cartaoFinal: string | null; // 4 últimos dígitos
  cartaoNome: string | null; // nome do cartão no banco (ex.: Revolut "BM 21 - 04.05")
  descricao: string;
  valor: number;
  moeda: string;
  codigo: string | null;
  situacao: Situacao;
  contaAnuncio: string | null; // da fatura PDF (só quando "ok")
  contaAnuncioNome: string | null;
};

/** Soma POR MOEDA (USD e EUR nunca se somam — sem câmbio confiável, somar daria número falso). */
export type Valores = Record<string, number>;
export type Parcial = { qtd: number; valor: Valores };

const somar = (v: Valores, moeda: string, valor: number) => { v[moeda] = Math.round(((v[moeda] ?? 0) + valor) * 100) / 100; };
const vazio = (): Parcial => ({ qtd: 0, valor: {} });
const contar = (p: Parcial, c: CobrancaMeta) => { p.qtd++; somar(p.valor, c.moeda, c.valor); };

export type ResumoCartao = {
  chave: string; // contaId + final do cartão — identifica o cartão nos outros pedidos
  empresa: string;
  banco: string;
  contaId: string;
  conta: string;
  cartaoFinal: string | null;
  cartaoNome: string | null;
  total: number;
  ok: number;
  semPdf: number;
  semCodigo: number;
  valorOk: Valores; // checado
  valorPendente: Valores; // sem PDF + sem código
};

/** Checado × pendente do mês, em quantidade E valor (por moeda). */
export function totaisDoMes(cobrancas: CobrancaMeta[]) {
  const t = { total: vazio(), checado: vazio(), pendente: vazio(), semCodigo: vazio(), semPdf: vazio() };
  for (const c of cobrancas) {
    contar(t.total, c);
    if (c.situacao === "ok") contar(t.checado, c);
    else {
      contar(t.pendente, c);
      contar(c.situacao === "sem_codigo" ? t.semCodigo : t.semPdf, c);
    }
  }
  return t;
}

const SEM_CARTAO = "-";
export const chaveCartao = (contaId: string, final: string | null) => `${contaId}:${final ?? SEM_CARTAO}`;

/** Onde = cobranças Meta do mês, no escopo do usuário (e da empresa escolhida, já conferida por quem chama). */
export async function ondeCobrancasDoMes(user: AppUser, month: string, companyId?: string | null): Promise<Prisma.TransactionWhereInput> {
  const inicio = new Date(`${month}-01T00:00:00.000Z`);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  return {
    isMetaCharge: true,
    date: { gte: inicio, lt: fim },
    AND: [await transactionScope(user)],
    ...(companyId ? { account: { companyId } } : {}),
  };
}

/** As cobranças (todas, ou só as de um cartão), da mais recente pra mais antiga. */
export async function cobrancasDoMes(onde: Prisma.TransactionWhereInput, chave?: string): Promise<CobrancaMeta[]> {
  let where = onde;
  if (chave) {
    const i = chave.lastIndexOf(":");
    const contaId = chave.slice(0, i);
    const final = chave.slice(i + 1);
    where = { AND: [onde, { accountId: contaId, cardLast4: final === SEM_CARTAO ? null : final }] };
  }
  const linhas = await prisma.transaction.findMany({
    where,
    select: {
      id: true, date: true, description: true, amount: true, currency: true, billAmount: true, billCurrency: true,
      metaRef: true, hasReceipt: true, cardLast4: true, cardLabel: true, accountId: true,
      account: { select: { name: true, bank: true, company: { select: { name: true } } } },
    },
    orderBy: [{ date: "desc" }, { id: "asc" }],
  });

  // conta de anúncio de cada cobrança "ok", tirada da fatura PDF (o código casa sem diferenciar maiúscula)
  const codigosOk = [...new Set(linhas.filter((t) => t.hasReceipt && t.metaRef).map((t) => t.metaRef!.toLowerCase()))];
  const faturas = codigosOk.length
    ? await prisma.$queryRaw<{ ref: string; accountId: string | null; accountName: string | null }[]>`
        SELECT lower("referenceNumber") AS ref, "accountId", "accountName" FROM "MetaReceipt"
        WHERE lower("referenceNumber") = ANY(${codigosOk})`
    : [];
  const faturaDe = new Map(faturas.map((f) => [f.ref, f]));

  return linhas.map((t) => {
    const fatura = t.hasReceipt && t.metaRef ? faturaDe.get(t.metaRef.toLowerCase()) : undefined;
    return {
      id: t.id,
      data: t.date.toISOString().slice(0, 10),
      empresa: t.account.company.name,
      banco: t.account.bank,
      contaId: t.accountId,
      conta: t.account.name,
      cartaoFinal: t.cardLast4,
      cartaoNome: t.cardLabel,
      descricao: t.description,
      valor: t.billAmount ?? Math.abs(t.amount),
      moeda: t.billAmount != null ? (t.billCurrency ?? t.currency) : t.currency,
      codigo: t.metaRef,
      situacao: t.hasReceipt ? "ok" : t.metaRef ? "sem_pdf" : "sem_codigo",
      contaAnuncio: fatura?.accountId ?? null,
      contaAnuncioNome: fatura?.accountName ?? null,
    };
  });
}

/** Só pra ORDENAR: soma o valor pendente pelo valor de face, sem converter moeda ("é só pra ter uma ideia"). */
const somaParaOrdenar = (v: Valores) => Object.values(v).reduce((soma, valor) => soma + valor, 0);

/**
 * Resumo por cartão: quantas ok e quantas pendentes. Ordem: MAIOR VALOR PENDENTE primeiro
 * (pedido do dono em 2026-10-22: "organiza essa tela por valor pendente").
 */
export function resumoPorCartao(cobrancas: CobrancaMeta[]): ResumoCartao[] {
  const porChave = new Map<string, ResumoCartao>();
  for (const c of cobrancas) {
    const chave = chaveCartao(c.contaId, c.cartaoFinal);
    const r = porChave.get(chave) ?? {
      chave, empresa: c.empresa, banco: c.banco, contaId: c.contaId, conta: c.conta,
      cartaoFinal: c.cartaoFinal, cartaoNome: c.cartaoNome, total: 0, ok: 0, semPdf: 0, semCodigo: 0, valorOk: {}, valorPendente: {},
    };
    r.total++;
    if (c.situacao === "ok") { r.ok++; somar(r.valorOk, c.moeda, c.valor); }
    else {
      if (c.situacao === "sem_pdf") r.semPdf++;
      else r.semCodigo++;
      somar(r.valorPendente, c.moeda, c.valor);
    }
    r.cartaoNome ??= c.cartaoNome; // a mais recente que tiver nome (vêm da mais recente pra mais antiga)
    porChave.set(chave, r);
  }
  return [...porChave.values()].sort((a, b) =>
    somaParaOrdenar(b.valorPendente) - somaParaOrdenar(a.valorPendente)
    || b.semPdf + b.semCodigo - (a.semPdf + a.semCodigo) || b.total - a.total || a.chave.localeCompare(b.chave));
}

const SITUACAO_CSV: Record<Situacao, string> = { ok: "Com fatura", sem_pdf: "Sem PDF", sem_codigo: "Sem código" };

/** CSV pro Excel em português: separador ";", vírgula decimal, data dd/mm/aaaa e BOM (acentos certos). */
export function cobrancasCsv(cobrancas: CobrancaMeta[]): string {
  const campo = (v: string | number | null) => {
    const s = v == null ? "" : typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecalho = ["Data", "Empresa", "Banco", "Conta", "Cartão (final)", "Nome do cartão", "Descrição", "Valor", "Moeda", "Código Meta", "Situação", "Conta de anúncio (fatura)", "Nome da conta de anúncio"];
  const linhas = cobrancas.map((c) => [
    c.data.split("-").reverse().join("/"), c.empresa, c.banco, c.conta, c.cartaoFinal, c.cartaoNome, c.descricao,
    c.valor, c.moeda, c.codigo, SITUACAO_CSV[c.situacao], c.contaAnuncio, c.contaAnuncioNome,
  ].map(campo).join(";"));
  return "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}
