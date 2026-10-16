import { prisma } from "./db";
import { KEY_MAP } from "./mercury";

export interface ResolvedCredential {
  company: string;
  token: string;
  secrets: Record<string, string>;
}

const ENV_TOKEN: Record<string, string> = {
  mercury: "MERCURY_API_TOKEN",
  wise: "WISE_API_TOKEN",
  revolut: "REVOLUT_ACCESS_TOKEN",
  meta: "META_ACCESS_TOKEN",
};

/**
 * Token de um emissor para UMA empresa (cadastrado na UI). Cai em fallbacks de env
 * legados do Finance (KEY_MAP do Mercury, WISE_API_KEY) e por fim no token único.
 * Retorna null se nada encontrado.
 */
export async function getCredentialToken(issuer: string, company?: string | null): Promise<string | null> {
  if (company) {
    const row = await prisma.credential.findFirst({ where: { issuer, company, isActive: true } });
    if (row?.token) return row.token;
  }
  // qualquer credencial cadastrada do emissor (caso a empresa não bata exatamente)
  const any = await prisma.credential.findFirst({ where: { issuer, isActive: true } });
  if (any?.token) return any.token;
  const envVar = ENV_TOKEN[issuer];
  return (envVar && process.env[envVar]) || null;
}

/**
 * Token do banco para UMA conta — fonte única para sync/mercury, sync/wise, sync/status e sync/all.
 *  1. o token da própria conta;
 *  2. a credencial cadastrada da PRÓPRIA empresa da conta (nome exato);
 *  3. SÓ com allowGlobal (superadmin): os legados — qualquer credencial do emissor, o token do .env,
 *     e as chaves globais (KEY_MAP do Mercury / WISE_API_KEY*).
 * Sem allowGlobal, o 3 nunca entra: senão quem é de um grupo puxaria, pela chave de outro grupo,
 * transações de uma conta bancária que não é dele (bastava informar o id da conta no banco).
 */
export async function resolveBankToken(
  bank: "mercury" | "wise",
  account: { apiToken: string | null; company: { name: string } | null },
  opts: { allowGlobal: boolean; mercuryEntity?: string | null },
): Promise<string | null> {
  if (account.apiToken) return account.apiToken;
  const company = account.company?.name;
  if (company) {
    const own = await prisma.credential.findFirst({ where: { issuer: bank, company, isActive: true } });
    if (own?.token) return own.token;
  }
  if (!opts.allowGlobal) return null;
  const legacy = await getCredentialToken(bank, null); // qualquer credencial do emissor → token do .env
  if (legacy) return legacy;
  if (bank === "mercury") return KEY_MAP[opts.mercuryEntity ?? "activeview"] || process.env.MERCURY_API_KEY || null;
  return process.env.WISE_API_KEY || process.env.WISE_API_KEY_ACTIVEVIEW_LLC || null;
}

export const NO_OWN_TOKEN_MESSAGE =
  "Esta conta não tem credencial própria do banco. Peça a um administrador para cadastrar o token da conta.";

/**
 * Credenciais ativas de um emissor (uma por empresa). Se nenhuma cadastrada no DB,
 * cai no token único do .env (empresa "default") — mantém o setup simples funcionando.
 */
export async function getCredentials(issuer: string): Promise<ResolvedCredential[]> {
  const rows = await prisma.credential.findMany({ where: { issuer, isActive: true } });
  if (rows.length > 0) {
    return rows.map((r) => ({
      company: r.company,
      token: r.token,
      secrets: parseSecrets(r.secrets),
    }));
  }
  // Fallback .env
  const envVar = ENV_TOKEN[issuer];
  const token = envVar ? process.env[envVar] : undefined;
  if (token) {
    const secrets: Record<string, string> = {};
    if (issuer === "wise" && process.env.WISE_PROFILE_ID) secrets.profileId = process.env.WISE_PROFILE_ID;
    return [{ company: "default", token, secrets }];
  }
  return [];
}

function parseSecrets(s: string | null): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}
