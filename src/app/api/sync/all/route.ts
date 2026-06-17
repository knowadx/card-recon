import { prisma } from "@/lib/db";
import { KEY_MAP } from "@/lib/mercury";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

const MERCURY_BASE = "https://api.mercury.com/api/v1";
const WISE_BASE = "https://api.wise.com";

async function syncMercury(accountId: string, mercuryAccountId: string, entity: string, from: string) {
  const key = KEY_MAP[entity];
  if (!key) return { imported: 0, skipped: 0, error: `No key for ${entity}` };

  // Use global /transactions endpoint with accountId filter — works for bank + credit accounts
  const url = new URL(`${MERCURY_BASE}/transactions`);
  url.searchParams.set("accountId", mercuryAccountId);
  url.searchParams.set("limit", "500");
  url.searchParams.set("start", from);
  url.searchParams.set("end", new Date().toISOString().slice(0, 10));

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return { imported: 0, skipped: 0, error: `Mercury API ${res.status}` };

  const data = await res.json();
  const transactions = data.transactions ?? [];

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((t) => t.reference));
  const toCreate = transactions.filter((tx: { status: string; id: string }) =>
    tx.status !== "failed" && !existingRefs.has(tx.id)
  );

  if (toCreate.length > 0) {
    await prisma.transaction.createMany({ data: toCreate.map((tx: { id: string; postedAt: string; createdAt: string; counterpartyName: string; bankDescription: string | null; amount: number }) => ({
        accountId,
        date: new Date(tx.postedAt ?? tx.createdAt),
        description: tx.counterpartyName || tx.bankDescription || "—",
        amount: tx.amount,
        currency: "USD",
        reference: tx.id,
      })),
    });
  }

  return { imported: toCreate.length, skipped: transactions.length - toCreate.length };
}

async function syncWise(accountId: string, profileId: string, from: string) {
  const key = process.env.WISE_API_KEY_ACTIVEVIEW_LLC;
  if (!key) return { imported: 0, skipped: 0, error: "No Wise key" };

  const end = new Date().toISOString();
  const start = `${from}T00:00:00.000Z`;

  const all = [];
  let cursor: string | null = null;
  while (true) {
    const url = new URL(`${WISE_BASE}/v1/profiles/${profileId}/activities`);
    url.searchParams.set("size", "100");
    url.searchParams.set("intervalStart", start);
    url.searchParams.set("intervalEnd", end);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) break;
    const data = await res.json();
    const acts = data.activities ?? [];
    all.push(...acts);
    cursor = data.cursor?.next ?? null;
    if (!cursor || acts.length === 0) break;
  }

  const completed = all.filter((a: { status: string; primaryAmount: string }) =>
    a.status === "COMPLETED" && a.primaryAmount
  );

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((t) => t.reference));

  const candidates = completed
    .filter((a: { id: string }) => !existingRefs.has(`wise-activity:${a.id}`))
    .map((a: { id: string; primaryAmount: string; title: string; createdOn: string }) => {
      const raw = a.primaryAmount;
      const isPositive = raw.includes("<positive>");
      const text = raw.replace(/<[^>]+>/g, "").trim();
      const match = text.match(/([+-]?\s*[\d,]+\.?\d*)\s+([A-Z]{3})/);
      if (!match) return null;
      const num = parseFloat(match[1].replace(/,/g, "").replace(/\s/g, ""));
      return {
        accountId,
        date: new Date(a.createdOn),
        description: a.title.replace(/<[^>]+>/g, "").trim(),
        amount: isPositive ? Math.abs(num) : -Math.abs(num),
        currency: match[2],
        reference: `wise-activity:${a.id}`,
      };
    })
    .filter(Boolean) as Array<{ accountId: string; date: Date; description: string; amount: number; currency: string; reference: string }>;

  const existingFp = await prisma.transaction.findMany({
    where: { accountId },
    select: { date: true, description: true, amount: true },
  });
  const existingFpSet = new Set(
    existingFp.map((t) => `${t.description}|${t.amount}|${new Date(t.date).toISOString().slice(0, 10)}`)
  );
  const seenInBatch = new Set<string>();
  const toCreate = candidates
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .filter((tx) => {
      const fp = `${tx.description}|${tx.amount}|${tx.date.toISOString().slice(0, 10)}`;
      if (existingFpSet.has(fp) || seenInBatch.has(fp)) return false;
      seenInBatch.add(fp);
      return true;
    });

  if (toCreate.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.transaction.createMany as any)({ data: toCreate, skipDuplicates: true });
  }

  return { imported: toCreate.length, skipped: completed.length - toCreate.length };
}

async function syncRevolut(accountId: string, companyName: string, revolutAccountId: string | null, from: string) {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(companyName);
  } catch {
    return { imported: 0, skipped: 0, error: "Revolut not authorized" };
  }

  const all = [];
  let createdBefore: string | null = null;
  const toDate = new Date().toISOString();

  while (true) {
    const url = new URL(`${REVOLUT_BASE}/transactions`);
    url.searchParams.set("from", `${from}T00:00:00Z`);
    url.searchParams.set("to", toDate);
    url.searchParams.set("count", "1000");
    if (createdBefore) url.searchParams.set("created_before", createdBefore);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { imported: 0, skipped: 0, error: `Revolut API ${res.status}` };

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 1000) break;
    createdBefore = batch[batch.length - 1].created_at;
  }

  const completed = all.filter((tx: { state: string }) => tx.state === "completed" || tx.state === "COMPLETED");

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map(t => t.reference));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = completed.flatMap((tx: any) =>
    tx.legs
      .filter((leg: any) => !revolutAccountId || leg.account_id === revolutAccountId)
      .map((leg: any) => {
        const ref = `revolut:${tx.id}:${leg.leg_id}`;
        if (existingRefs.has(ref)) return null;
        return {
          accountId,
          date: new Date(tx.completed_at ?? tx.created_at),
          description: tx.merchant?.name || leg.counterparty?.name || leg.description || tx.reference || "Revolut",
          amount: leg.amount,
          currency: leg.currency,
          reference: ref,
        };
      })
      .filter(Boolean)
  );

  if (candidates.length > 0) await prisma.transaction.createMany({ data: candidates });
  return { imported: candidates.length, skipped: completed.length - candidates.length };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const from: string = body.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const accounts = await prisma.account.findMany({
    where: { syncConfig: { not: null } },
    include: { company: true },
  });

  if (accounts.length === 0) {
    return Response.json({ error: "Nenhuma conta com sync configurado. Faça um sync manual primeiro." }, { status: 400 });
  }

  const results = await Promise.all(
    accounts.map(async (account) => {
      const config = JSON.parse(account.syncConfig!);
      let result;
      if (config.mercuryAccountId) {
        result = await syncMercury(account.id, config.mercuryAccountId, config.mercuryEntity ?? "activeview", from);
      } else if (config.wiseProfileId) {
        result = await syncWise(account.id, config.wiseProfileId, from);
      } else if ("revolutAccountId" in config) {
        result = await syncRevolut(account.id, account.company.name, config.revolutAccountId, from);
      } else {
        result = { imported: 0, skipped: 0, error: "Config inválida" };
      }
      return { accountId: account.id, accountName: account.name, ...result };
    })
  );

  const totalImported = results.reduce((s, r) => s + (r.imported ?? 0), 0);
  const totalSkipped = results.reduce((s, r) => s + (r.skipped ?? 0), 0);

  return Response.json({ imported: totalImported, skipped: totalSkipped, accounts: results });
}
