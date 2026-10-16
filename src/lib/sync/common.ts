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
