import { prisma } from "@/lib/db";
import { KEY_MAP } from "@/lib/mercury";

const MERCURY_BASE = "https://api.mercury.com/api/v1";

async function fetchAllTransactions(key: string, mercuryAccountId: string, start: string, end: string) {
  const all: unknown[] = [];
  let startAfter: string | null = null;
  const limit = 500;

  while (true) {
    // Use the global /transactions endpoint with accountId filter — works for both
    // bank accounts and credit card accounts
    const url = new URL(`${MERCURY_BASE}/transactions`);
    url.searchParams.set("accountId", mercuryAccountId);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    if (startAfter) url.searchParams.set("start_after", startAfter);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Mercury API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const txs: Array<{
      id: string;
      counterpartyName: string;
      bankDescription: string | null;
      amount: number;
      postedAt: string | null;
      createdAt: string;
      status: string;
      note: string | null;
      externalMemo: string | null;
      kind: string;
      merchantName: string | null;
    }> = data.transactions ?? [];

    all.push(...txs);

    if (txs.length < limit) break;
    startAfter = txs[txs.length - 1].id;
  }

  return all as Array<{
    id: string;
    counterpartyName: string;
    bankDescription: string | null;
    merchantName: string | null;
    amount: number;
    postedAt: string | null;
    createdAt: string;
    status: string;
    note: string | null;
    externalMemo: string | null;
    kind: string;
  }>;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { mercuryAccountId, accountId, from, to, entity } = body as {
    mercuryAccountId: string;
    accountId: string;
    from?: string;
    to?: string;
    entity?: string;
  };

  const key = KEY_MAP[entity ?? "activeview"] ?? process.env.MERCURY_API_KEY;
  if (!key) return Response.json({ error: "Mercury API key not set" }, { status: 500 });

  if (!mercuryAccountId || !accountId) {
    return Response.json({ error: "mercuryAccountId and accountId required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });

  const end = to ?? new Date().toISOString().slice(0, 10);
  const start = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const transactions = await fetchAllTransactions(key, mercuryAccountId, start, end);

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((t) => t.reference));

  const toCreate = transactions.filter(
    (tx) => tx.status !== "failed" && tx.status !== "cancelled" && !existingRefs.has(tx.id)
  );

  if (toCreate.length === 0) {
    return Response.json({ imported: 0, skipped: transactions.length });
  }

  await prisma.transaction.createMany({
    data: toCreate.map((tx) => ({
      accountId,
      date: new Date(tx.postedAt ?? tx.createdAt),
      description: tx.merchantName || tx.counterpartyName || tx.bankDescription || "—",
      amount: tx.amount,
      currency: "USD",
      reference: tx.id,
    })),
  });

  await prisma.account.update({
    where: { id: accountId },
    data: { syncConfig: JSON.stringify({ mercuryAccountId, mercuryEntity: entity ?? "activeview" }) },
  });

  return Response.json({
    imported: toCreate.length,
    skipped: transactions.length - toCreate.length,
    range: { start, end },
  });
}
