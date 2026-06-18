import { prisma } from "./db";
import { fetchBillingCharges } from "./meta";

/** Roda fn sobre items com no máximo `limit` em paralelo. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Popula MetaBillingCharge com as cobranças reais (act_<id>/activities) das contas das
 * credenciais dadas. `since` em YYYY-MM-DD. Não roda o matching (chame runChargeMatch depois).
 */
export async function syncBillingCharges(
  creds: { token: string; operationId: string | null }[],
  since: string,
  until?: string,
): Promise<{ charges: number; accountsOk: number; accountsErr: number }> {
  let charges = 0;
  let accountsOk = 0;
  let accountsErr = 0;

  for (const cred of creds) {
    const accounts = await prisma.metaAdAccount.findMany({
      where: cred.operationId ? { operationId: cred.operationId } : {},
      select: { accountId: true, name: true, bmId: true, bmName: true, operationId: true },
    });
    await mapLimit(accounts, 6, async (a) => {
      try {
        const list = await fetchBillingCharges(cred.token, a.accountId, since, until);
        accountsOk++;
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
      } catch {
        accountsErr++;
      }
    });
  }
  return { charges, accountsOk, accountsErr };
}
