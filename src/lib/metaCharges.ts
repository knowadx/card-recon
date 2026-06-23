import { prisma } from "./db";
import { fetchBillingCharges } from "./meta";

/** Piso de data da Checagem: só consideramos cobranças de maio/2026 em diante. */
export const CHECK_FLOOR = new Date("2026-05-01T00:00:00.000Z");

/** Roda fn sobre items com no máximo `limit` em paralelo. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export interface SyncFailure {
  accountId: string;
  name: string | null;
  reason: "sem_acesso" | "falhou";
  error: string;
}

export interface SyncResult {
  charges: number;
  accountsOk: number;
  accountsTotal: number;
  failed: SyncFailure[];
}

// erro de permissão (não adianta retry) × falha transitória que esgotou as tentativas
const PERMISSION_RE = /permission|#200|#10\b|#100\b|do not have|não tem|unauthor|forbidden|unsupported get request/i;

/**
 * Popula MetaBillingCharge com as cobranças reais (act_<id>/activities) de TODAS as contas
 * das credenciais dadas. `since`/`until` em YYYY-MM-DD. Cada conta tem retry por página
 * (no fetch). Se mesmo assim falhar, é registrada em `failed` (com motivo) — nunca some em
 * silêncio. Retorna a completude (accountsOk / accountsTotal) p/ saber se o lado Meta está cheio.
 */
export async function syncBillingCharges(
  creds: { token: string; operationId: string | null }[],
  since: string,
  until?: string,
): Promise<SyncResult> {
  let charges = 0;
  let accountsOk = 0;
  let accountsTotal = 0;
  const failed: SyncFailure[] = [];

  for (const cred of creds) {
    const accounts = await prisma.metaAdAccount.findMany({
      where: cred.operationId ? { operationId: cred.operationId } : {},
      select: { accountId: true, name: true, bmId: true, bmName: true, operationId: true },
    });
    accountsTotal += accounts.length;
    await mapLimit(accounts, 6, async (a) => {
      try {
        const list = await fetchBillingCharges(cred.token, a.accountId, since, until);
        for (const ch of list) {
          await prisma.metaBillingCharge.upsert({
            where: { transactionId: ch.transactionId },
            update: { amountUsd: ch.amountUsd, currency: ch.currency, chargedAt: ch.chargedAt, accountName: a.name, bmId: a.bmId, bmName: a.bmName, operationId: a.operationId },
            create: {
              transactionId: ch.transactionId, accountId: a.accountId, accountName: a.name,
              bmId: a.bmId, bmName: a.bmName, operationId: a.operationId,
              amountUsd: ch.amountUsd, currency: ch.currency, chargedAt: ch.chargedAt,
            },
          });
          charges++;
        }
        accountsOk++;
      } catch (e) {
        const error = (e as Error).message;
        failed.push({ accountId: a.accountId, name: a.name, reason: PERMISSION_RE.test(error) ? "sem_acesso" : "falhou", error });
      }
    });
  }
  return { charges, accountsOk, accountsTotal, failed };
}
