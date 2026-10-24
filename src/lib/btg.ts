import { prisma } from "./db";
import { apenasDigitos, cnpjValido } from "./cnpj";

/**
 * BTG Pactual Empresas — API direta da conta PJ (pedido do dono em 2026-10-24; Open Finance rejeitado).
 * Fonte: documentação oficial (developers.empresas.btgpactual.com — "Definições Gerais", "Authorization
 * Code", "Consultar dados da conta", "Consultar extrato por accountId") + id.btgpactual.com/.well-known.
 *
 * UM app "First party" (consumir recursos de contas próprias), criado no Internet Banking do BTG:
 * BTG_CLIENT_ID / BTG_CLIENT_SECRET no servidor. A autorização é POR EMPRESA (o login escolhe o CNPJ):
 * Credential(issuer="btg", company=<id da empresa no PixelFinance>), token = refresh token,
 * secrets = { accessToken, accessExp, cnpj }.
 */

const AMBIENTES = {
  producao: { api: "https://api.empresas.btgpactual.com", id: "https://id.btgpactual.com" },
  sandbox: { api: "https://api.sandbox.empresas.btgpactual.com", id: "https://id.sandbox.btgpactual.com" },
} as const;

// escopos de leitura da conta (nomes da lista pública do BTG Id); trocáveis por BTG_ESCOPOS se o app pedir outros
const ESCOPOS_PADRAO = "openid brn:btg:empresas:banking:accounts:info.readonly brn:btg:empresas:banking:accounts:statement.readonly brn:btg:empresas:banking:accounts:balances.readonly";

export function btgConfig() {
  const clientId = process.env.BTG_CLIENT_ID?.trim();
  const clientSecret = process.env.BTG_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const ambiente = process.env.BTG_AMBIENTE === "sandbox" ? "sandbox" : "producao";
  return { clientId, clientSecret, ambiente, ...AMBIENTES[ambiente], escopos: process.env.BTG_ESCOPOS?.trim() || ESCOPOS_PADRAO };
}

export class BtgNaoConfigurado extends Error {
  constructor() { super("BTG não configurado no servidor (BTG_CLIENT_ID / BTG_CLIENT_SECRET)"); }
}
export class BtgSemConsentimento extends Error {}

function exigirConfig() {
  const cfg = btgConfig();
  if (!cfg) throw new BtgNaoConfigurado();
  return cfg;
}

export { apenasDigitos, cnpjValido };

/** GET /oauth2/authorize?client_id&response_type=code&redirect_uri&scope&prompt=login (+ state anti-CSRF). */
export function btgAuthorizeUrl(redirectUri: string, state: string): string {
  const cfg = exigirConfig();
  const u = new URL(`${cfg.id}/oauth2/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", cfg.escopos);
  u.searchParams.set("prompt", "login");
  u.searchParams.set("state", state);
  return u.toString();
}

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number };

/** POST /oauth2/token com Basic <client_id:client_secret> (form-urlencoded). */
async function pedirToken(params: Record<string, string>): Promise<Tokens> {
  const cfg = exigirConfig();
  const res = await fetch(`${cfg.id}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`BTG token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<Tokens>;
}

const segredos = (s: string | null): Record<string, string | number> => {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
};

/** Troca o code pelo token e grava a credencial da empresa (sobrescreve a anterior). */
export async function btgConcluirConsentimento(empresa: { id: string; name: string; cnpj: string | null }, code: string, redirectUri: string) {
  const t = await pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const secrets = JSON.stringify({ accessToken: t.access_token, accessExp: Math.floor(Date.now() / 1000) + (t.expires_in ?? 86400), cnpj: apenasDigitos(empresa.cnpj) });
  await prisma.credential.upsert({
    where: { issuer_company: { issuer: "btg", company: empresa.id } },
    update: { token: t.refresh_token ?? "", secrets, isActive: true },
    create: { issuer: "btg", company: empresa.id, token: t.refresh_token ?? "", secrets },
  });
}

/** Access token válido da empresa (renova pelo refresh token quando faltar menos de 1 min). */
export async function btgAccessToken(companyId: string): Promise<string> {
  const cred = await prisma.credential.findUnique({ where: { issuer_company: { issuer: "btg", company: companyId } } });
  if (!cred || !cred.isActive) throw new BtgSemConsentimento("BTG desta empresa não conectado");
  const s = segredos(cred.secrets);
  const agora = Math.floor(Date.now() / 1000);
  if (typeof s.accessToken === "string" && Number(s.accessExp) > agora + 60) return s.accessToken;
  if (!cred.token) throw new BtgSemConsentimento("BTG desta empresa sem autorização válida — conecte de novo");
  const t = await pedirToken({ grant_type: "refresh_token", refresh_token: cred.token });
  await prisma.credential.update({
    where: { id: cred.id },
    data: { token: t.refresh_token ?? cred.token, secrets: JSON.stringify({ ...s, accessToken: t.access_token, accessExp: agora + (t.expires_in ?? 86400) }) },
  });
  return t.access_token;
}

/** GET na API do BTG (caminho relativo, ou URL absoluta do `_links.next`). */
export async function btgGet(companyId: string, caminhoOuUrl: string): Promise<Response> {
  const cfg = exigirConfig();
  const url = caminhoOuUrl.startsWith("http") ? caminhoOuUrl : `${cfg.api}${caminhoOuUrl}`;
  if (!url.startsWith(cfg.api)) throw new Error("URL fora da API do BTG"); // o next vem da resposta: nunca segue pra outro host
  return fetch(url, { headers: { Authorization: `Bearer ${await btgAccessToken(companyId)}` }, signal: AbortSignal.timeout(30000) });
}

export type BtgConta = { accountId: string; taxId?: string; bankCode?: number; branchCode?: string; number?: string };

/** GET /{CNPJ}/banking/accounts — contas da empresa no BTG. */
export async function btgListarContas(companyId: string, cnpj: string): Promise<BtgConta[]> {
  const res = await btgGet(companyId, `/${apenasDigitos(cnpj)}/banking/accounts`);
  if (!res.ok) throw new Error(`BTG contas ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { data?: BtgConta[] };
  return Array.isArray(j.data) ? j.data : [];
}

/** Empresas (ids do PixelFinance) com o BTG conectado. */
export async function btgEmpresasConectadas(): Promise<string[]> {
  const rows = await prisma.credential.findMany({ where: { issuer: "btg", isActive: true, NOT: { token: "" } }, select: { company: true } });
  return rows.map((r) => r.company);
}
