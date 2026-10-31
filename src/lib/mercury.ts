export const MERCURY_BASE = "https://api.mercury.com/api/v1";

export const KEY_MAP: Record<string, string | undefined> = {
  activeview: process.env.MERCURY_API_KEY,
  "4ads": process.env.MERCURY_API_KEY_4ADS,
};

/** Uma "extração" da Mercury: cada conta bancária (checking/savings) e cada conta de crédito do token. */
export type ExtracaoMercury = { id: string; name: string; nickname?: string | null; kind?: string; entity: string; legalBusinessName: string; [k: string]: unknown };

/** Lista as extrações do token (contas + crédito). Rótulo = nome da conta local (não da empresa). */
export async function listarExtracoesMercury(label: string, key: string): Promise<ExtracaoMercury[]> {
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
