import { prisma } from "./db";

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
