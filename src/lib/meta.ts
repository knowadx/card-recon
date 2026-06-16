import { getSetting } from "./settings";

/**
 * Cliente mínimo da Meta Marketing API (Graph API).
 *
 * NOTA DE ARQUITETURA: a Marketing API NÃO expõe eventos de cobrança individuais
 * no cartão. O que extraímos aqui:
 *   - lista de Contas de Anúncio (com o BM/business dono);
 *   - qual CARTÃO financia cada conta (funding_source_details.display_string);
 *   - SPEND por período (endpoint insights).
 * A cobrança real (valor que tocou o cartão) vem das APIs de banco.
 */

const GRAPH = "https://graph.facebook.com";

async function token(): Promise<string> {
  const t = await getSetting("meta.accessToken", "META_ACCESS_TOKEN");
  if (!t) throw new Error("META_ACCESS_TOKEN ausente — configure em /settings ou no .env");
  return t;
}

function version(): string {
  return process.env.META_API_VERSION || "v21.0";
}

/** GET genérico na Graph API, com paginação automática (segue paging.next). */
async function graphGetAll<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const accessToken = await token();
  const out: T[] = [];
  let url: string | null =
    `${GRAPH}/${version()}/${path}?` +
    new URLSearchParams({ ...params, access_token: accessToken, limit: "100" }).toString();

  while (url) {
    const res: Response = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText;
      throw new Error(`Meta API ${res.status}: ${msg}`);
    }
    if (Array.isArray(json.data)) out.push(...json.data);
    else out.push(json);
    url = json.paging?.next ?? null;
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
export async function fetchAdAccounts(): Promise<{ accounts: MetaAdAccount[]; bmAvailable: boolean }> {
  try {
    const accounts = await graphGetAll<MetaAdAccount>("me/adaccounts", {
      fields: [...BASE_FIELDS, "business{id,name}"].join(","),
    });
    return { accounts, bmAvailable: true };
  } catch (e) {
    const msg = (e as Error).message;
    // Sem business_management → refaz sem o campo business
    if (/business_management|Missing Permission|#100/i.test(msg)) {
      const accounts = await graphGetAll<MetaAdAccount>("me/adaccounts", {
        fields: BASE_FIELDS.join(","),
      });
      return { accounts, bmAvailable: false };
    }
    throw e;
  }
}

/** Spend de uma conta num intervalo (YYYY-MM-DD). Retorna em moeda da conta. */
export async function fetchSpend(
  accountId: string, // "act_123" ou "123"
  since: string,
  until: string,
): Promise<number> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const rows = await graphGetAll<{ spend?: string }>(`${act}/insights`, {
    fields: "spend",
    level: "account",
    time_range: JSON.stringify({ since, until }),
  });
  return rows.reduce((sum, r) => sum + (r.spend ? parseFloat(r.spend) : 0), 0);
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
