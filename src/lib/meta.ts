/**
 * Cliente mínimo da Meta Marketing API (Graph API). Token POR EMPRESA (passado
 * por parâmetro). Define o universo de contas controladas + o cartão de funding
 * de cada uma (funding_source_details) — base da checagem anti-vazamento.
 */

const GRAPH = "https://graph.facebook.com";

function version(): string {
  return process.env.META_API_VERSION || "v21.0";
}

// ===== OAuth (Facebook Login) — cada perfil conecta com um clique =====

export function metaAuthorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${version()}/dialog/oauth`);
  u.searchParams.set("client_id", process.env.META_APP_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  // ads_management: necessário p/ act_<id>/activities expor os eventos de cobrança
  // (event_type=ad_account_billing_charge) — a "Atividade de pagamento" do Business Suite.
  u.searchParams.set("scope", "ads_read,ads_management,business_management");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

/** Troca o code por um token long-lived (~60 dias) do usuário. */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) throw new Error("META_APP_ID/META_APP_SECRET ausentes");

  // 1) code → token curto
  const shortRes = await fetch(
    `${GRAPH}/${version()}/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, client_secret: secret, code }).toString(),
  );
  const shortJson = await shortRes.json();
  if (!shortRes.ok) throw new Error(`Meta OAuth ${shortRes.status}: ${shortJson?.error?.message ?? shortRes.statusText}`);

  // 2) curto → long-lived (~60d)
  const longRes = await fetch(
    `${GRAPH}/${version()}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: shortJson.access_token,
      }).toString(),
  );
  const longJson = await longRes.json();
  if (!longRes.ok) throw new Error(`Meta extend ${longRes.status}: ${longJson?.error?.message ?? longRes.statusText}`);
  return longJson.access_token as string;
}

/** Perfil (usuário) Meta dono do token — { id, name }. Usado p/ exibir qual perfil conectou. */
export async function fetchMetaUser(token: string): Promise<{ id: string; name: string } | null> {
  try {
    const res = await fetch(`${GRAPH}/${version()}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const j = await res.json();
    if (!res.ok || !j?.id) return null;
    return { id: j.id, name: j.name ?? j.id };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Códigos de erro transitórios da Graph API (rate limit / temporário) → vale retry.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014]);

/**
 * Busca UMA página com retry/backoff exponencial em erro transitório (HTTP 429/5xx,
 * códigos de rate limit, ou falha de rede). Só lança depois de esgotar as tentativas —
 * assim um soluço da API não derruba a conta inteira (e a página não se perde).
 */
async function graphFetchPage(url: string): Promise<Record<string, unknown>> {
  const MAX = 5;
  let delay = 600;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try {
      res = await fetch(url);
      json = await res.json();
    } catch (e) {
      if (attempt >= MAX) throw e; // erro de rede → retry
      await sleep(delay + Math.random() * 300); delay *= 2; continue;
    }
    if (res.ok) return json;
    const code = json?.error?.code;
    const transient = res.status === 429 || res.status >= 500 || (typeof code === "number" && TRANSIENT_CODES.has(code));
    if (transient && attempt < MAX) { await sleep(delay + Math.random() * 300); delay *= 2; continue; }
    throw new Error(`Meta API ${res.status}: ${json?.error?.message || res.statusText}`);
  }
}

/** GET genérico na Graph API, com paginação automática (segue paging.next) e retry por página. */
async function graphGetAll<T = Record<string, unknown>>(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null =
    `${GRAPH}/${version()}/${path}?` +
    new URLSearchParams({ ...params, access_token: token, limit: "100" }).toString();

  while (url) {
    const json = await graphFetchPage(url);
    if (Array.isArray(json.data)) out.push(...(json.data as T[]));
    else out.push(json as T);
    url = (json.paging as { next?: string } | undefined)?.next ?? null;
  }
  return out;
}

export interface MetaFundingSource {
  id?: string;
  type?: number;
  display_string?: string; // ex.: "Visa *1234", "Mastercard ··1234"
}

export interface MetaAdAccount {
  id: string; // "act_123"
  account_id: string; // "123"
  name: string;
  currency: string;
  account_status?: number;
  amount_spent?: string; // em centavos da moeda da conta (string)
  funding_source_details?: MetaFundingSource;
  business?: { id: string; name: string };
}

const BASE_FIELDS = ["account_id", "name", "currency", "account_status", "amount_spent", "funding_source_details"];

/**
 * Lista todas as contas de anúncio acessíveis pelo token, com cartão de funding.
 * Tenta incluir o BM (`business{}`); se o token não tiver `business_management`,
 * refaz a chamada sem o BM (as contas ficam sem bmId).
 */
export async function fetchAdAccounts(token: string): Promise<{ accounts: MetaAdAccount[]; bmAvailable: boolean }> {
  try {
    const accounts = await graphGetAll<MetaAdAccount>(token, "me/adaccounts", {
      fields: [...BASE_FIELDS, "business{id,name}"].join(","),
    });
    return { accounts, bmAvailable: true };
  } catch (e) {
    const msg = (e as Error).message;
    // Sem business_management → refaz sem o campo business
    if (/business_management|Missing Permission|#100/i.test(msg)) {
      const accounts = await graphGetAll<MetaAdAccount>(token, "me/adaccounts", {
        fields: BASE_FIELDS.join(","),
      });
      return { accounts, bmAvailable: false };
    }
    throw e;
  }
}

/**
 * Universo COMPLETO de contas controladas: une /me/adaccounts com as contas de cada BM
 * (owned + client) via /me/businesses. Pega mais contas (e mais cartões de funding) do que
 * só /me/adaccounts, que lista apenas as contas em que o usuário está atribuído diretamente.
 * Dedup por account_id. Retorna também as BMs sem nenhuma conta acessível (furo de acesso).
 */
export async function fetchControlledAccounts(token: string): Promise<{
  accounts: MetaAdAccount[];
  bmAvailable: boolean;
  emptyBusinesses: { id: string; name: string }[];
}> {
  const byId = new Map<string, MetaAdAccount>();
  let bmAvailable = true;

  // 1) contas diretas
  const direct = await fetchAdAccounts(token);
  bmAvailable = direct.bmAvailable;
  for (const a of direct.accounts) byId.set(a.account_id, a);

  // 2) contas via cada BM (owned + client) — captura as que /me/adaccounts não lista
  const emptyBusinesses: { id: string; name: string }[] = [];
  try {
    const businesses = await graphGetAll<{ id: string; name: string }>(token, "me/businesses", { fields: "id,name" });
    for (const b of businesses) {
      let countForBm = 0;
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
        try {
          const list = await graphGetAll<MetaAdAccount>(token, `${b.id}/${edge}`, {
            fields: [...BASE_FIELDS, "business{id,name}"].join(","),
          });
          for (const a of list) {
            countForBm++;
            const existing = byId.get(a.account_id);
            // garante bm preenchido mesmo quando /me/adaccounts veio sem business
            if (!existing) byId.set(a.account_id, { ...a, business: a.business ?? { id: b.id, name: b.name } });
            else if (!existing.business) existing.business = a.business ?? { id: b.id, name: b.name };
          }
        } catch { /* edge pode falhar p/ BM sem permissão — ignora */ }
      }
      if (countForBm === 0) emptyBusinesses.push({ id: b.id, name: b.name });
    }
  } catch { /* sem business_management → fica só com as diretas */ }

  return { accounts: Array.from(byId.values()), bmAvailable, emptyBusinesses };
}

export interface MetaCharge {
  transactionId: string;
  amountUsd: number; // new_value / 100
  currency: string;
  chargedAt: Date;
}

/**
 * Cobranças reais de uma conta (act_<id>/activities, event=ad_account_billing_charge).
 * É a "Atividade de pagamento" do Business Suite. Exige ads_management. `since` em YYYY-MM-DD.
 */
export async function fetchBillingCharges(token: string, accountId: string, since: string, until?: string): Promise<MetaCharge[]> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const params: Record<string, string> = { fields: "event_type,event_time,extra_data", since };
  if (until) params.until = until;
  const rows = await graphGetAll<{ event_type?: string; event_time?: string; extra_data?: string | Record<string, unknown> }>(
    token,
    `${act}/activities`,
    params,
  );
  const out: MetaCharge[] = [];
  for (const r of rows) {
    if (r.event_type !== "ad_account_billing_charge") continue;
    const ex = typeof r.extra_data === "string" ? safeJson(r.extra_data) : (r.extra_data ?? {});
    const newValue = Number((ex as Record<string, unknown>).new_value);
    const txId = (ex as Record<string, unknown>).transaction_id as string | undefined;
    if (!txId || !Number.isFinite(newValue)) continue;
    out.push({
      transactionId: txId,
      amountUsd: newValue / 100,
      currency: ((ex as Record<string, unknown>).currency as string) ?? "USD",
      chargedAt: r.event_time ? new Date(r.event_time) : new Date(),
    });
  }
  return out;
}

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Extrai bandeira + últimos 4 dígitos de um display_string como "Visa *1234".
 * Retorna { brand, last4 } (qualquer um pode ser null).
 */
export function parseFundingDisplay(display?: string | null): {
  brand: string | null;
  last4: string | null;
} {
  if (!display) return { brand: null, last4: null };
  const last4Match = display.match(/(\d{4})(?!.*\d)/); // último grupo de 4 dígitos
  const last4 = last4Match ? last4Match[1] : null;
  // bandeira = texto antes dos asteriscos/dígitos
  const brandMatch = display.match(/^([A-Za-zÀ-ÿ ]+?)\s*[*·•\d]/);
  const brand = brandMatch ? brandMatch[1].trim() : null;
  return { brand, last4 };
}
