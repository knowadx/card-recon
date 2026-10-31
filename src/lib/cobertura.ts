import { prisma } from "./db";

/**
 * Cobertura de importação — a regra ÚNICA de "já importei este mês desta conta?" (decisão do dono em
 * 2026-10-30: "nunca consigo saber exatamente o que já importei. Qual conta, e qual mês").
 *
 * Cada importação que leu um período INTEIRO grava um trecho (ImportCoverage): o sync da API pela janela
 * que leu até o fim, o OFX pelo período do arquivo. Mês sem lançamento mas coberto = importado (sem
 * movimento) — diferente de nunca importado. Mês completo = algum trecho (já mesclado) vai do 1º instante
 * do mês até o fim dele. Contagem de transações NÃO prova importação.
 */

export type Trecho = { de: Date; ate: Date }; // ate = exclusivo (coberto até este instante)
export type CoberturaDoMes =
  | { estado: "completo" }
  | { estado: "parcial"; pedacos: Trecho[] } // pedaços já recortados dentro do mês
  | { estado: "nenhuma" };

/** Início do mês (UTC, como as datas das transações). */
export function inicioDoMes(mes: string): Date {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/** Fim do mês = início do mês seguinte (UTC). */
export function fimDoMes(mes: string): Date {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}

/** "AAAA-MM-DD" → meia-noite UTC daquele dia; outro formato → a data como veio. */
export function inicioDoDia(data: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T00:00:00.000Z`) : new Date(data);
}

/** Junta trechos que se sobrepõem ou se encostam; devolve em ordem. */
export function mesclar(trechos: Trecho[]): Trecho[] {
  const ord = trechos.filter((t) => t.ate > t.de).sort((a, b) => a.de.getTime() - b.de.getTime());
  const out: Trecho[] = [];
  for (const t of ord) {
    const ultimo = out[out.length - 1];
    if (ultimo && t.de <= ultimo.ate) {
      if (t.ate > ultimo.ate) ultimo.ate = t.ate;
    } else {
      out.push({ de: t.de, ate: t.ate });
    }
  }
  return out;
}

/** Como os trechos (MESCLADOS) cobrem o mês. */
export function coberturaDoMes(mesclados: Trecho[], mes: string): CoberturaDoMes {
  const ini = inicioDoMes(mes);
  const fim = fimDoMes(mes);
  if (mesclados.some((t) => t.de <= ini && t.ate >= fim)) return { estado: "completo" };
  const pedacos = mesclados
    .filter((t) => t.de < fim && t.ate > ini)
    .map((t) => ({ de: t.de < ini ? ini : t.de, ate: t.ate > fim ? fim : t.ate }));
  return pedacos.length ? { estado: "parcial", pedacos } : { estado: "nenhuma" };
}

/** Último dia coberto (o dia do instante logo antes do fim do trecho), ou null sem cobertura. */
export function cobertaAte(mesclados: Trecho[]): Date | null {
  const ultimo = mesclados[mesclados.length - 1];
  return ultimo ? new Date(ultimo.ate.getTime() - 1) : null;
}

/** Trechos mesclados por conta (contas sem cobertura não aparecem no mapa). */
export async function coberturaPorConta(accountIds: string[]): Promise<Map<string, Trecho[]>> {
  const linhas = accountIds.length
    ? await prisma.importCoverage.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, from: true, to: true } })
    : [];
  const brutos = new Map<string, Trecho[]>();
  for (const l of linhas) {
    const lista = brutos.get(l.accountId) ?? [];
    lista.push({ de: l.from, ate: l.to });
    brutos.set(l.accountId, lista);
  }
  return new Map([...brutos].map(([id, t]) => [id, mesclar(t)]));
}

/** Grava o trecho que uma importação provou completo. Trecho vazio/invertido não grava. */
export async function registrarCobertura(c: {
  accountId: string;
  de: Date;
  ate: Date;
  fonte: "api" | "ofx";
  userId?: string | null;
  importLogId?: string | null;
}): Promise<void> {
  if (!(c.ate > c.de)) return;
  await prisma.importCoverage.create({
    data: { accountId: c.accountId, from: c.de, to: c.ate, source: c.fonte, userId: c.userId ?? null, importLogId: c.importLogId ?? null },
  });
}
