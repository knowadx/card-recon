import { prisma } from "@/lib/db";
import { isMetaMerchant, extractMetaRef } from "@/lib/metaCheck";
import { NO_OWN_TOKEN_MESSAGE, resolveBankToken } from "@/lib/credentials";
import { isSuperadmin } from "@/lib/auth";
import { getSyncPeriod } from "@/lib/settings";
import { assertAccount, type AppUser } from "@/lib/access";
import { markSynced, type SyncOutcome } from "./common";

const MERCURY_BASE = "https://api.mercury.com/api/v1";

type MercuryTransaction = {
  id: string;
  counterpartyName: string;
  bankDescription: string | null;
  merchantName: string | null;
  amount: number;
  postedAt: string | null;
  createdAt: string;
  status: string;
  note: string | null;
  externalMemo: string | null;
  kind: string;
  details?: { debitCardInfo?: { id?: string }; creditCardInfo?: { id?: string } } | null;
};

export type MercurySyncBody =
  | { imported: number; skipped: number; range?: { start: string; end: string } }
  | { error: string };

// Mapa cardId(UUID) → últimos 4 dígitos, da conta Mercury
async function fetchCardMap(key: string, mercuryAccountId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`${MERCURY_BASE}/account/${mercuryAccountId}/cards`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const data = await res.json();
      for (const c of data.cards ?? []) {
        if (c.cardId && c.lastFourDigits) map.set(c.cardId, c.lastFourDigits);
      }
    }
  } catch {
    /* conta sem cartões */
  }
  return map;
}

async function fetchAllTransactions(key: string, mercuryAccountId: string, start: string, end: string): Promise<MercuryTransaction[]> {
  const all: MercuryTransaction[] = [];
  let startAfter: string | null = null;
  const limit = 500;

  while (true) {
    // Use the global /transactions endpoint with accountId filter — works for both
    // bank accounts and credit card accounts
    const url = new URL(`${MERCURY_BASE}/transactions`);
    url.searchParams.set("accountId", mercuryAccountId);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    if (startAfter) url.searchParams.set("start_after", startAfter);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Mercury API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const txs: MercuryTransaction[] = data.transactions ?? [];

    all.push(...txs);

    if (txs.length < limit) break;
    startAfter = txs[txs.length - 1].id;
  }

  return all;
}

/**
 * Sync de UMA conta Mercury — a ÚNICA implementação (rota /api/sync/mercury e /api/sync/all).
 *  - conta fora do escopo do usuário: AccessError (404);
 *  - token: resolveBankToken (o da conta / da própria empresa; legados só p/ superadmin);
 *  - pagina por start_after; pula failed/cancelled e refs já gravadas;
 *  - grava cartão (últimos 4), cobrança Meta (isMetaCharge/metaRef) e a operação da conta;
 *  - saveSyncConfig: a rota lembra a conta escolhida no banco; o sync/all só LÊ o que está salvo.
 * Erro da API do Mercury: lança (a rota responde 500; o sync/all reporta na conta).
 */
export async function syncMercuryAccount(opts: {
  user: AppUser;
  accountId: string;
  mercuryAccountId: string;
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  saveSyncConfig: boolean;
}): Promise<SyncOutcome<MercurySyncBody>> {
  const { user, accountId, mercuryAccountId, entity, from, to } = opts;
  await assertAccount(user, accountId); // conta de outro grupo = 404

  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return { status: 404, body: { error: "account not found" } };

  // Token: 1º o da própria CONTA (1 token por conta), depois fallbacks legados
  const key = await resolveBankToken("mercury", account, { allowGlobal: isSuperadmin(user.role), mercuryEntity: entity });
  if (!key) {
    const msg = isSuperadmin(user.role) ? "Token Mercury não cadastrado nesta conta" : NO_OWN_TOKEN_MESSAGE;
    return { status: 400, body: { error: msg } };
  }

  const period = await getSyncPeriod();
  const end = to || new Date().toISOString().slice(0, 10); // sempre até HOJE (o "até" do período não trava)
  const start = from || period.from;

  const [transactions, cardMap] = await Promise.all([
    fetchAllTransactions(key, mercuryAccountId, start, end),
    fetchCardMap(key, mercuryAccountId),
  ]);

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((t) => t.reference));

  const toCreate = transactions.filter(
    (tx) => tx.status !== "failed" && tx.status !== "cancelled" && !existingRefs.has(tx.id)
  );

  // terminou de ler a janela inteira → a conta está sincronizada até o fim dela
  const ate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  if (toCreate.length === 0) {
    await markSynced(accountId, ate);
    return { status: 200, body: { imported: 0, skipped: transactions.length } };
  }

  await prisma.transaction.createMany({
    data: toCreate.map((tx) => {
      const cardId = tx.details?.debitCardInfo?.id ?? tx.details?.creditCardInfo?.id;
      return {
        accountId,
        date: new Date(tx.postedAt ?? tx.createdAt),
        description: tx.merchantName || tx.counterpartyName || tx.bankDescription || "—",
        amount: tx.amount,
        currency: "USD",
        reference: tx.id,
        cardLast4: cardId ? cardMap.get(cardId) ?? null : null,
        isMetaCharge: isMetaMerchant(tx.merchantName, tx.counterpartyName, tx.bankDescription),
        metaRef: extractMetaRef(tx.merchantName, tx.counterpartyName, tx.bankDescription),
        operationId: account.operationId,
      };
    }),
  });

  if (opts.saveSyncConfig) {
    await prisma.account.update({
      where: { id: accountId },
      data: { syncConfig: JSON.stringify({ mercuryAccountId, mercuryEntity: entity ?? "activeview" }) },
    });
  }

  await markSynced(accountId, ate);
  return {
    status: 200,
    body: { imported: toCreate.length, skipped: transactions.length - toCreate.length, range: { start, end } },
  };
}
