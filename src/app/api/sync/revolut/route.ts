import { prisma } from "@/lib/db";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";
import { isMetaMerchant, last4Of } from "@/lib/metaCheck";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RevolutTransaction {
  id: string;
  type: string;
  state: string;
  created_at: string;
  completed_at?: string;
  legs: Array<{
    leg_id: string;
    account_id: string;
    counterparty?: { account_id?: string; account_type?: string; name?: string };
    amount: number;
    fee?: number;
    currency: string;
    description?: string;
    balance?: number;
  }>;
  merchant?: { name?: string };
  card?: { card_number?: string; last_digits?: string };
  reference?: string;
}

/** fetch que, no 429 do Revolut, espera o Retry-After (ou backoff) e tenta de novo. */
async function fetchWith429Retry(url: string, init: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const ra = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : Math.min(2000 * 2 ** attempt, 30000);
    console.warn(`Revolut 429 — aguardando ${Math.round(waitMs / 1000)}s (tentativa ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { accountId, revolutAccountId, from } = body as {
    accountId: string;
    revolutAccountId?: string;
    from?: string;
  };

  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(account.company.name);
  } catch (e) {
    console.error(e); return Response.json({ error: `Revolut da empresa "${account.company.name}" não conectado`, needsAuth: true }, { status: 401 });
  }

  const fromDate = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString();

  const headers = { Authorization: `Bearer ${accessToken}` };

  // Fetch all transactions with pagination
  const all: RevolutTransaction[] = [];
  let createdBefore: string | null = null;

  // guarda anti-loop: no máximo 50 páginas (50k tx) e para se o cursor não avançar
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${REVOLUT_BASE}/transactions`);
    url.searchParams.set("from", `${fromDate}T00:00:00Z`);
    url.searchParams.set("to", toDate);
    url.searchParams.set("count", "1000");
    if (createdBefore) url.searchParams.set("created_before", createdBefore);

    const res = await fetchWith429Retry(url.toString(), { headers });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 429) {
        return Response.json(
          { error: "Revolut está limitando as requisições (429). Aguarde uns minutos e tente novamente — sincronize uma conta por vez." },
          { status: 429 },
        );
      }
      return Response.json({ error: `Revolut API ${res.status}: ${err}` }, { status: 502 });
    }

    const batch: RevolutTransaction[] = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 1000) break;
    const nextCursor = batch[batch.length - 1].created_at;
    if (nextCursor === createdBefore) break; // cursor não avançou → evita loop infinito
    createdBefore = nextCursor;
  }

  const completed = all.filter(tx => tx.state === "completed" || tx.state === "COMPLETED");

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map(t => t.reference));

  const candidates = completed.flatMap(tx => {
    return tx.legs
      .filter(leg => {
        if (revolutAccountId && leg.account_id !== revolutAccountId) return false;
        return true;
      })
      .map(leg => {
        const ref = `revolut:${tx.id}:${leg.leg_id}`;
        if (existingRefs.has(ref)) return null;

        const description =
          tx.merchant?.name ||
          leg.counterparty?.name ||
          leg.description ||
          tx.reference ||
          "Revolut";

        const date = new Date(tx.completed_at ?? tx.created_at);

        const fee = leg.fee ?? 0;
        // For outgoing payments, fee is charged on top of the transfer amount.
        // leg.amount is the net value; total debit = leg.amount - fee (both negative for outflows).
        const totalAmount = leg.amount < 0 ? leg.amount - fee : leg.amount;

        return {
          accountId,
          date,
          description,
          amount: totalAmount,
          fee,
          currency: leg.currency,
          reference: ref,
          cardLast4: last4Of(tx.card?.last_digits ?? tx.card?.card_number),
          isMetaCharge: isMetaMerchant(tx.merchant?.name, leg.counterparty?.name, leg.description),
          operationId: account.operationId,
        };
      })
      .filter(Boolean) as Array<{ accountId: string; date: Date; description: string; amount: number; currency: string; reference: string; cardLast4: string | null; isMetaCharge: boolean; operationId: string | null }>;
  });

  if (candidates.length > 0) {
    await prisma.transaction.createMany({ data: candidates });
  }

  // Save syncConfig for "sync all"
  const syncConfig = JSON.stringify({ revolutAccountId: revolutAccountId ?? null });
  await prisma.account.update({ where: { id: accountId }, data: { syncConfig } });

  return Response.json({
    imported: candidates.length,
    skipped: completed.length - candidates.length,
    total: all.length,
  });
}
