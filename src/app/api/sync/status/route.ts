import { prisma } from "@/lib/db";
import { KEY_MAP } from "@/lib/mercury";
import { getValidAccessToken } from "@/lib/revolut";
import { getCredentialToken } from "@/lib/credentials";

const MERCURY_BASE = "https://api.mercury.com/api/v1";

async function checkMercury(token: string): Promise<{ ok: boolean; label: string }> {
  try {
    const res = await fetch(`${MERCURY_BASE}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { ok: true, label: "Conectada" };
    if (res.status === 401) return { ok: false, label: "Token inválido" };
    if (res.status === 403) return { ok: false, label: "Sem permissão" };
    return { ok: false, label: `Erro ${res.status}` };
  } catch {
    return { ok: false, label: "Sem conexão" };
  }
}

async function checkWise(token: string): Promise<{ ok: boolean; label: string }> {
  try {
    const res = await fetch("https://api.wise.com/v1/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { ok: true, label: "Conectada" };
    if (res.status === 401) return { ok: false, label: "Token inválido" };
    return { ok: false, label: `Erro ${res.status}` };
  } catch {
    return { ok: false, label: "Sem conexão" };
  }
}

export async function GET() {
  const accounts = await prisma.account.findMany({
    select: { id: true, bank: true, apiToken: true, company: { select: { name: true } } },
  });

  // cache por token (evita chamadas repetidas pro mesmo token)
  const cache = new Map<string, { ok: boolean; label: string }>();
  const revolutCache = new Map<string, { ok: boolean; label: string }>();

  const results = await Promise.all(
    accounts.map(async (account) => {
      const bank = account.bank;

      if (bank === "Mercury" || bank === "Wise") {
        const token =
          account.apiToken ||
          (await getCredentialToken(bank.toLowerCase(), account.company.name)) ||
          (bank === "Mercury" ? KEY_MAP.activeview || process.env.MERCURY_API_KEY : process.env.WISE_API_KEY) ||
          undefined;
        if (!token) return { accountId: account.id, ok: false, label: "Chave não configurada" };
        if (!cache.has(token)) cache.set(token, await (bank === "Mercury" ? checkMercury(token) : checkWise(token)));
        return { accountId: account.id, ...cache.get(token)! };
      }

      if (bank === "Revolut") {
        const co = account.company.name;
        if (!revolutCache.has(co)) {
          try {
            await getValidAccessToken(co);
            revolutCache.set(co, { ok: true, label: "Conectada" });
          } catch {
            revolutCache.set(co, { ok: false, label: "Não conectado" });
          }
        }
        return { accountId: account.id, ...revolutCache.get(co)! };
      }

      return { accountId: account.id, ok: null, label: "Manual" };
    }),
  );

  return Response.json(Object.fromEntries(results.map((r) => [r.accountId, { ok: r.ok, label: r.label }])));
}
