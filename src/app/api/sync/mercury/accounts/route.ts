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
    ? ((await creditRes.json()).accounts ?? []).map((c: { id: string; availableBalance: number; status: string }, i: number) => ({
        ...c,
        entity: label,
        kind: "credit",
        name: `Mercury Credit${i > 0 ? ` ${i + 1}` : ""}`,
        legalBusinessName: label,
      }))
    : [];

  return [...accounts, ...credits];
}

export async function GET() {
  // Tokens: credenciais cadastradas na UI (por empresa) + fallback env KEY_MAP
  const dbCreds = await prisma.credential.findMany({ where: { issuer: "mercury", isActive: true } });
  const sources: Array<{ label: string; key: string }> = [];
  const seen = new Set<string>();

  for (const c of dbCreds) {
    if (c.token && !seen.has(c.token)) {
      sources.push({ label: c.company, key: c.token });
      seen.add(c.token);
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
