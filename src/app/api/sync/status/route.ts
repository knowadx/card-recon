import { prisma } from "@/lib/db";
import { KEY_MAP } from "@/lib/mercury";
import { getValidAccessToken } from "@/lib/revolut";

const MERCURY_BASE = "https://api.mercury.com/api/v1";

async function checkMercury(entity: string): Promise<{ ok: boolean; label: string }> {
  const key = KEY_MAP[entity];
  if (!key) return { ok: false, label: "Chave não configurada" };
  try {
    const res = await fetch(`${MERCURY_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true, label: "Conectada" };
    if (res.status === 401) return { ok: false, label: "Token inválido" };
    if (res.status === 403) return { ok: false, label: "Sem permissão" };
    return { ok: false, label: `Erro ${res.status}` };
  } catch {
    return { ok: false, label: "Sem conexão" };
  }
}

async function checkWise(): Promise<{ ok: boolean; label: string }> {
  const key = process.env.WISE_API_KEY;
  if (!key) return { ok: false, label: "Chave não configurada" };
  try {
    const res = await fetch("https://api.wise.com/v1/me", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true, label: "Conectada" };
    if (res.status === 401) return { ok: false, label: "Token inválido" };
    return { ok: false, label: `Erro ${res.status}` };
  } catch {
    return { ok: false, label: "Sem conexão" };
  }
}

function inferMercuryEntity(companyName: string): string {
  const lower = companyName.toLowerCase();
  if (lower.includes("4ads") || lower.includes("4 ads")) return "4ads";
  return "activeview";
}

export async function GET() {
  const accounts = await prisma.account.findMany({
    select: { id: true, bank: true, syncConfig: true, company: { select: { name: true } } },
  });

  // Cache API checks per entity/bank — avoid redundant requests
  const mercuryCache = new Map<string, { ok: boolean; label: string }>();
  let wiseStatus: { ok: boolean; label: string } | null = null;

  const results = await Promise.all(
    accounts.map(async (account) => {
      const bank = account.bank;

      // Banks with no API integration — always Manual
      if (!["Mercury", "Wise", "Revolut"].includes(bank)) {
        return { accountId: account.id, ok: null, label: "Manual" };
      }

      // If syncConfig exists, use it to determine entity
      if (account.syncConfig) {
        let config: Record<string, string>;
        try { config = JSON.parse(account.syncConfig); } catch {
          return { accountId: account.id, ok: false, label: "Config inválida" };
        }

        if (config.mercuryAccountId) {
          const entity = config.mercuryEntity ?? "activeview";
          if (!mercuryCache.has(entity)) mercuryCache.set(entity, await checkMercury(entity));
          return { accountId: account.id, ...mercuryCache.get(entity)! };
        }

        if (config.wiseProfileId) {
          if (!wiseStatus) wiseStatus = await checkWise();
          return { accountId: account.id, ...wiseStatus };
        }
      }

      // No syncConfig — still check API by bank type
      if (bank === "Mercury") {
        const entity = inferMercuryEntity(account.company.name);
        if (!mercuryCache.has(entity)) mercuryCache.set(entity, await checkMercury(entity));
        return { accountId: account.id, ...mercuryCache.get(entity)! };
      }

      if (bank === "Wise") {
        if (!wiseStatus) wiseStatus = await checkWise();
        return { accountId: account.id, ...wiseStatus! };
      }

      if (bank === "Revolut") {
        try {
          await getValidAccessToken(prisma);
          return { accountId: account.id, ok: true, label: "Conectada" };
        } catch {
          return { accountId: account.id, ok: false, label: "Não autorizado" };
        }
      }

      return { accountId: account.id, ok: null, label: "Manual" };
    })
  );

  return Response.json(Object.fromEntries(results.map((r) => [r.accountId, { ok: r.ok, label: r.label }])));
}
