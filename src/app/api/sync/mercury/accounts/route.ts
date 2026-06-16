import { prisma } from "@/lib/db";

const MERCURY_BASE = "https://api.mercury.com/api/v1";

// Fallback de env (legado do Finance)
export const KEY_MAP: Record<string, string | undefined> = {
  activeview: process.env.MERCURY_API_KEY,
  "4ads": process.env.MERCURY_API_KEY_4ADS,
};

async function fetchAccounts(label: string, key: string) {
  const headers = { Authorization: `Bearer ${key}` };
  const [accountsRes, creditRes] = await Promise.all([
    fetch(`${MERCURY_BASE}/accounts`, { headers }),
    fetch(`${MERCURY_BASE}/credit`, { headers }),
  ]);
  const accounts = accountsRes.ok
    ? ((await accountsRes.json()).accounts ?? []).map((a: object) => ({ ...a, entity: label, legalBusinessName: label }))
    : [];
  const credits = creditRes.ok
    ? ((await creditRes.json()).accounts ?? []).map((c: { id: string }, i: number) => ({
        ...c,
        entity: label,
        kind: "credit",
        name: `Mercury Credit${i > 0 ? ` ${i + 1}` : ""}`,
        legalBusinessName: label,
      }))
    : [];
  return [...accounts, ...credits];
}

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");

  // 1 token por conta: se veio accountId, lista usando o token DAQUELA conta
  if (accountId) {
    const acc = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
    if (!acc?.apiToken) return Response.json([]);
    return Response.json(await fetchAccounts(acc.company?.name ?? acc.name, acc.apiToken).catch(() => []));
  }

  // Sem accountId: agrega todos os tokens conhecidos (contas + env) — retrocompat
  const accountsWithToken = await prisma.account.findMany({
    where: { bank: "Mercury", NOT: { apiToken: null } },
    include: { company: true },
  });
  const sources: Array<{ label: string; key: string }> = [];
  const seen = new Set<string>();
  for (const a of accountsWithToken) {
    if (a.apiToken && !seen.has(a.apiToken)) {
      sources.push({ label: a.company?.name ?? a.name, key: a.apiToken });
      seen.add(a.apiToken);
    }
  }
  for (const [entity, key] of Object.entries(KEY_MAP)) {
    if (key && !seen.has(key)) {
      sources.push({ label: entity, key });
      seen.add(key);
    }
  }
  const results = await Promise.all(sources.map(({ label, key }) => fetchAccounts(label, key).catch(() => [])));
  return Response.json(results.flat());
}
