/**
 * Cliente da Wise Platform API (1 token POR EMPRESA, passado por parâmetro).
 * Auth = Bearer token simples — SEM SCA/chave privada.
 *
 * Caminho (como no projeto finance): /v1/profiles/{id}/activities lista tudo
 * (CARD_PAYMENT, TRANSFER, ...) só com o bearer. Para cobranças de cartão, o
 * detalhe em /v3/profiles/{id}/card-transactions/{id} traz cardLastDigits +
 * merchant + valor (também só com bearer). O statement.json (que exige SCA) NÃO
 * é usado.
 */

function base(): string {
  return process.env.WISE_API_BASE || "https://api.wise.com";
}

async function wget<T = unknown>(token: string, path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Wise ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

export interface WiseProfile {
  id: number;
  type: string; // "PERSONAL" | "BUSINESS"
}

export interface WiseActivity {
  id: string;
  type: string; // CARD_PAYMENT | TRANSFER | BALANCE_ASSET_FEE | TOPUP | ...
  resource?: { type: string; id: string };
  title: string;
  description?: string;
  primaryAmount: string; // ex.: "<positive>+ 2.57 USD</positive>" ou "2.57 USD"
  secondaryAmount?: string;
  status: string; // COMPLETED | ...
  createdOn: string;
}

export interface WiseCardTransaction {
  id: string;
  cardToken?: string;
  cardLastDigits?: string;
  state?: string;
  createdDate?: string;
  transactionAmount?: { amount?: number; currency?: string };
  merchant?: { id?: string; name?: string; location?: Record<string, unknown> };
}

export async function fetchProfiles(token: string): Promise<WiseProfile[]> {
  return wget<WiseProfile[]>(token, "/v2/profiles");
}

/** Atividades do período (paginação por cursor). Só bearer, sem SCA. */
export async function fetchActivities(
  token: string,
  profileId: number | string,
  since: string,
  until: string,
): Promise<WiseActivity[]> {
  const all: WiseActivity[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${base()}/v1/profiles/${profileId}/activities`);
    url.searchParams.set("size", "100");
    url.searchParams.set("since", since);
    url.searchParams.set("until", until);
    if (cursor) url.searchParams.set("nextCursor", cursor);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const data = await res.json();
    const acts: WiseActivity[] = data.activities ?? [];
    all.push(...acts);
    cursor = typeof data.cursor === "string" ? data.cursor : null;
    if (!cursor || acts.length === 0) break;
  }
  return all;
}

/** Detalhe de uma transação de cartão — traz cardLastDigits + merchant. */
export async function fetchCardTransaction(
  token: string,
  profileId: number | string,
  cardTxId: string,
): Promise<WiseCardTransaction | null> {
  try {
    return await wget<WiseCardTransaction>(token, `/v3/profiles/${profileId}/card-transactions/${cardTxId}`);
  } catch {
    return null;
  }
}

const SYMBOL: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "R$": "BRL" };

/** Parseia "2.57 USD" / "R$ 69,80" de uma string (com tags HTML). Retorna valor absoluto. */
export function parseAmount(raw: string): { amount: number; currency: string } | null {
  const text = (raw || "").replace(/<[^>]+>/g, "").trim();
  let m = text.match(/[+-]?\s*([\d.,]+)\s+([A-Z]{3})/);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(num)) return { amount: num, currency: m[2] };
  }
  m = text.match(/(R\$|[€$£])\s*([\d.,]+)/);
  if (m) {
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!isNaN(num)) return { amount: num, currency: SYMBOL[m[1]] ?? "USD" };
  }
  return null;
}

export function stripTags(s?: string): string {
  return (s || "").replace(/<[^>]+>/g, "").trim();
}
