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
  const failed: SyncFailure[] = [];

  // token por operação; cred sem operationId = escopo amplo (todas as contas)
  const tokenByOp = new Map<string, string>();
  let broadToken: string | null = null;
  for (const c of creds) {
    if (c.operationId) tokenByOp.set(c.operationId, c.token);
    else broadToken = c.token;
  }

  // contas DISTINTAS no escopo (sem repetir conta que aparece em vários perfis)
  const where = broadToken ? {} : { operationId: { in: [...tokenByOp.keys()] } };
  const accounts = await prisma.metaAdAccount.findMany({
    where,
    select: { accountId: true, name: true, bmId: true, bmName: true, operationId: true },
  });
  const accountsTotal = accounts.length;

  await mapLimit(accounts, 6, async (a) => {
    const token = (a.operationId && tokenByOp.get(a.operationId)) || broadToken || creds[0]?.token;
    if (!token) { failed.push({ accountId: a.accountId, name: a.name, reason: "falhou", error: "sem token p/ a conta" }); return; }
    try {
      const list = await fetchBillingCharges(token, a.accountId, since, until);
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

  return { charges, accountsOk, accountsTotal, failed };
}
