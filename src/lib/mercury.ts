/**
 * Cliente da Mercury API. Auth = bearer token (1 token POR EMPRESA — o token é
 * passado por parâmetro; quem itera as empresas é a rota de sync via getCredentials).
 * Docs: https://docs.mercury.com/reference (api.mercury.com/api/v1)
 */

const BASE = "https://api.mercury.com/api/v1";

async function mget<T = unknown>(token: string, path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { errors?: { message?: string } })?.errors?.message || res.statusText;
    throw new Error(`Mercury ${res.status}: ${msg}`);
  }
  return json as T;
}

export interface MercuryAccount {
  id: string;
  name: string;
  type?: string;
}

export interface MercuryCard {
  cardId?: string;
  id?: string;
  lastFourDigits?: string;
  last4?: string;
  network?: string;
  status?: string;
  nickname?: string;
}

export interface MercuryTransaction {
  id: string;
  amount: number; // negativo = saída
  createdAt: string;
  postedAt?: string | null;
  counterpartyName?: string | null;
  status?: string;
  kind?: string;
  note?: string | null;
  bankDescription?: string | null;
  details?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export async function fetchAccounts(token: string): Promise<MercuryAccount[]> {
  const r = await mget<{ accounts?: MercuryAccount[] }>(token, "/accounts");
  return r.accounts ?? [];
}

/** Cartões de uma conta — cada um traz cardId + lastFourDigits. */
export async function fetchCards(token: string, accountId: string): Promise<MercuryCard[]> {
  const r = await mget<{ cards?: MercuryCard[] }>(token, `/account/${accountId}/cards`);
  return r.cards ?? [];
}

/** Transações de uma conta (paginação por offset; filtro de período feito em código). */
export async function fetchAccountTransactions(token: string, accountId: string): Promise<MercuryTransaction[]> {
  const out: MercuryTransaction[] = [];
  const limit = 500;
  for (let offset = 0; offset < 50 * limit; offset += limit) {
    const r = await mget<{ transactions?: MercuryTransaction[]; total?: number }>(
      token,
      `/account/${accountId}/transactions`,
      { limit: String(limit), offset: String(offset) },
    );
    const batch = r.transactions ?? [];
    out.push(...batch);
    if (batch.length < limit) break;
  }
  return out;
}

/**
 * UUID do cartão usado na transação (kind=debitCardTransaction).
 * Vem em details.debitCardInfo.id — resolvemos o last4 pelo registro de cartões.
 */
export function extractCardId(tx: MercuryTransaction): string | null {
  const d = (tx.details ?? {}) as Record<string, unknown>;
  const info = (d["debitCardInfo"] ?? d["creditCardInfo"]) as Record<string, unknown> | undefined;
  const id = info?.["id"];
  return typeof id === "string" ? id : null;
}
