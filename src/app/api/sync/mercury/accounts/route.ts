const MERCURY_BASE = "https://api.mercury.com/api/v1";

export const KEY_MAP: Record<string, string | undefined> = {
  activeview: process.env.MERCURY_API_KEY,
  "4ads": process.env.MERCURY_API_KEY_4ADS,
};

async function fetchAccounts(entity: string, key: string) {
  const headers = { Authorization: `Bearer ${key}` };

  const [accountsRes, creditRes] = await Promise.all([
    fetch(`${MERCURY_BASE}/accounts`, { headers }),
    fetch(`${MERCURY_BASE}/credit`, { headers }),
  ]);

  const accounts = accountsRes.ok
    ? ((await accountsRes.json()).accounts ?? []).map((a: object) => ({ ...a, entity }))
    : [];

  // Credit accounts come from /credit — add kind and a display name
  const credits = creditRes.ok
    ? ((await creditRes.json()).accounts ?? []).map((c: { id: string; availableBalance: number; status: string }, i: number) => ({
        ...c,
        entity,
        kind: "credit",
        name: `Mercury Credit${i > 0 ? ` ${i + 1}` : ""}`,
        legalBusinessName: entity === "activeview" ? "ActiveView INC" : "4ADS MEDIA LLC",
      }))
    : [];

  return [...accounts, ...credits];
}

export async function GET(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";

  if (debug) {
    // Return raw API responses for debugging
    const key = process.env.MERCURY_API_KEY;
    if (!key) return Response.json({ error: "no key" });
    const endpoints = [
      `${MERCURY_BASE}/accounts`,
      `${MERCURY_BASE}/credit-card/accounts`,
      `${MERCURY_BASE}/creditCard/accounts`,
      `${MERCURY_BASE}/credit-cards`,
      `${MERCURY_BASE}/creditCards`,
    ];
    const raw: Record<string, unknown> = {};
    for (const ep of endpoints) {
      const res = await fetch(ep, { headers: { Authorization: `Bearer ${key}` } });
      raw[ep] = { status: res.status, body: res.ok ? await res.json() : await res.text() };
    }
    return Response.json(raw);
  }

  const results = await Promise.all(
    Object.entries(KEY_MAP)
      .filter(([, key]) => Boolean(key))
      .map(([entity, key]) => fetchAccounts(entity, key!))
  );
  return Response.json(results.flat());
}
