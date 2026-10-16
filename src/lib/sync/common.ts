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

/**
 * Marca até quando a conta está sincronizada (fim da janela do sync que TERMINOU). O Fechamento
 * Meta só libera um mês quando toda conta configurada passou do fim dele (src/lib/importStatus.ts).
 */
export async function markSynced(accountId: string, through: Date): Promise<void> {
  await prisma.account.update({ where: { id: accountId }, data: { syncedThrough: through } });
}
