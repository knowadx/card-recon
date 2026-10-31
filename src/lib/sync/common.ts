import { prisma } from "@/lib/db";
/**
 * Peças comuns do sync de bancos (src/lib/sync/*). Cada banco tem UMA implementação, usada pela
 * rota do banco (/api/sync/mercury|wise|revolut) e pelo /api/sync/all.
 */

/** Resultado do sync de UMA conta: o corpo JSON e o status HTTP que a rota do banco responde. */
export type SyncOutcome<B> = { status: number; body: B };

/** Roda fn sobre items com no máximo `limit` em paralelo (preserva a ordem). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Chaves do syncConfig que dizem QUAL extração a conta puxa (uma por banco). */
export const EXTRACAO_CHAVES = ["mercuryAccountId", "btgAccountId", "revolutAccountId", "wiseProfileId"] as const;

/** A troca de config muda a extração já gravada? Devolve a chave trocada (ou null). */
export function extracaoTrocada(atual: Record<string, unknown>, nova: Record<string, unknown>): string | null {
  return EXTRACAO_CHAVES.find((k) => k in atual && k in nova && String(atual[k] ?? "") !== String(nova[k] ?? "")) ?? null;
}

/**
 * Cada conta = UMA extração FIXA (decisão do dono em 2026-10-30, depois de "a Mercury tem 3 extrações
 * dentro da conta — como sei quando puxei todas?"). Extração = o que o sync lê: a sub-conta da Mercury, a
 * conta do BTG, a conta do Revolut (ou todas), o perfil da Wise. Depois que a conta recebeu lançamentos,
 * puxar OUTRA extração nela misturaria as duas e a cobertura (src/lib/cobertura.ts) mentiria → recusa.
 * Também recusa a extração que já é de outra conta (duplicaria). Devolve o motivo, ou null se pode.
 */
export async function problemaDeExtracao(opts: {
  account: { id: string; name: string; bank: string; companyId: string; syncConfig: string | null };
  chave: "mercuryAccountId" | "btgAccountId" | "revolutAccountId";
  pedida: string | null; // Revolut: null = todas as contas
  rotulo: (v: string | null) => string;
}): Promise<string | null> {
  const { account, chave, pedida, rotulo } = opts;
  let config: Record<string, unknown> = {};
  try { config = account.syncConfig ? JSON.parse(account.syncConfig) : {}; } catch { /* config ilegível = sem extração salva */ }
  if (chave in config) {
    const atual = (config[chave] as string | null) ?? null;
    if (atual !== pedida && (await prisma.transaction.findFirst({ where: { accountId: account.id }, select: { id: true } }))) {
      return `a conta ${account.name} é da extração ${rotulo(atual)} — puxar ${rotulo(pedida)} nela misturaria as duas. Crie uma conta para essa extração.`;
    }
  }
  // a mesma extração (ou, no Revolut, uma que se sobrepõe: "todas" × qualquer uma) já é de outra conta
  const outras = await prisma.account.findMany({
    where: { id: { not: account.id }, bank: account.bank, syncConfig: { not: null }, ...(chave === "revolutAccountId" ? { companyId: account.companyId } : {}) },
    select: { name: true, syncConfig: true },
  });
  for (const o of outras) {
    let c: Record<string, unknown> = {};
    try { c = JSON.parse(o.syncConfig!); } catch { continue; }
    if (!(chave in c)) continue;
    const dela = (c[chave] as string | null) ?? null;
    const sobrepoe = chave === "revolutAccountId" ? dela === pedida || dela === null || pedida === null : dela === pedida;
    if (sobrepoe) return `a extração ${rotulo(pedida)} já é puxada na conta ${o.name} — puxar aqui também duplicaria os lançamentos`;
  }
  return null;
}
