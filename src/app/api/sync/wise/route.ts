import { prisma } from "@/lib/db";
import { isMetaMerchant } from "@/lib/metaCheck";

const WISE_BASE = "https://api.wise.com";

interface WiseActivity {
  id: string;
  type: string;
  resource?: { type: string; id: string };
  title: string;
  description?: string;
  primaryAmount: string;
  secondaryAmount?: string;
  status: string;
  createdOn: string;
}

interface WiseTransfer {
  id: number;
  sourceAccount: number | null;
  sourceValue: number;
  sourceCurrency: string;
  targetValue: number;
  targetCurrency: string;
  quoteUuid: string;
  status: string;
}

interface WiseQuote {
  payInMethod?: string;
  paymentOptions?: Array<{
    payIn: string;
    fee: { total: number; currency?: string };
  }>;
}

const SYMBOL_MAP: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", "R$": "BRL" };

function parseAmountString(raw: string): { absAmount: number; currency: string } | null {
  const text = raw.replace(/<[^>]+>/g, "").trim();
  let match = text.match(/[+-]?\s*([\d,]+\.?\d*)\s+([A-Z]{3})/);
  if (match) {
    const num = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(num)) return { absAmount: num, currency: match[2] };
  }
  match = text.match(/(R\$|[€$£])\s*([\d,]+\.?\d*)/);
  if (match) {
    const num = parseFloat(match[2].replace(/,/g, ""));
    if (!isNaN(num)) return { absAmount: num, currency: SYMBOL_MAP[match[1]] ?? "USD" };
  }
  return null;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!text || !res.ok) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchActivities(
  key: string,
  profileId: string,
  start: string,
  end: string
): Promise<WiseActivity[]> {
  const all: WiseActivity[] = [];
  let nextCursor: string | null = null;
  let page = 0;

  while (page < 50) {
    page++;
    const url = new URL(`${WISE_BASE}/v1/profiles/${profileId}/activities`);
    url.searchParams.set("size", "100");
    url.searchParams.set("since", start);
    url.searchParams.set("until", end);
    if (nextCursor) url.searchParams.set("nextCursor", nextCursor);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) break;

    const data = await res.json();
    const activities: WiseActivity[] = data.activities ?? [];
    all.push(...activities);

    nextCursor = typeof data.cursor === "string" ? data.cursor : null;
    if (!nextCursor || activities.length === 0) break;
  }

  return all;
}

// Resolve the actual amount, currency and fee for a TRANSFER activity.
// Flow: GET /v1/transfers/{id} → GET /v3/profiles/{profileId}/quotes/{quoteUuid}
// Falls back to secondaryAmount / primaryAmount if API calls fail.
// ownRecipientId: the profile's borderless account recipientId — if transfer.sourceAccount
// matches this, the transfer is outgoing; otherwise it's incoming.
async function resolveTransferAmount(
  activity: WiseActivity,
  profileId: string,
  ownRecipientId: number | null,
  headers: Record<string, string>
): Promise<{ amount: number; currency: string; fee: number } | null> {

  const resourceId = activity.resource?.id;
  const transfer = resourceId
    ? await fetchJson(`${WISE_BASE}/v1/transfers/${resourceId}`, headers) as WiseTransfer | null
    : null;

  if (transfer?.sourceValue && transfer?.sourceCurrency) {
    let fee = 0;

    // Direction detection:
    // Primary signal: <positive> tag in activity.primaryAmount — Wise explicitly marks
    // credits to our account. This overrides transferStatus because "outgoing_payment_sent"
    // appears on incoming external bank transfers too (it reflects the sender's action,
    // not our balance direction). e.g. RAHANDUSMINISTEERIUM VAT refunds and Google payments.
    const isExplicitlyPositive = activity.primaryAmount?.includes("<positive>");
    const outgoing = !isExplicitlyPositive && (
      transfer.status === "outgoing_payment_sent" ||
      (ownRecipientId !== null && transfer.sourceAccount === ownRecipientId)
    );

    if (outgoing && transfer.quoteUuid) {
      const quote = await fetchJson(
        `${WISE_BASE}/v3/profiles/${profileId}/quotes/${transfer.quoteUuid}`,
        headers
      ) as WiseQuote | null;

      if (quote?.paymentOptions) {
        const usedPayIn = quote.payInMethod ?? "BALANCE";
        const option =
          quote.paymentOptions.find(p => p.payIn === usedPayIn) ??
          quote.paymentOptions.find(p => p.payIn === "BALANCE") ??
          quote.paymentOptions[0];
        fee = option?.fee?.total ?? 0;
      }
    }

    if (outgoing) {
      return {
        amount: -(transfer.sourceValue + fee),
        currency: transfer.sourceCurrency,
        fee,
      };
    } else {
      // Incoming: record what arrived in the target currency (our balance)
      return {
        amount: transfer.targetValue,
        currency: transfer.targetCurrency,
        fee: 0,
      };
    }
  }

  // Fallback: parse secondaryAmount (total debit in source currency) or primaryAmount
  const isPositive = activity.primaryAmount?.includes("<positive>") ||
    activity.type === "TOPUP";

  if (activity.secondaryAmount && activity.secondaryAmount.trim() !== "") {
    const parsed = parseAmountString(activity.secondaryAmount);
    if (parsed) return { amount: isPositive ? parsed.absAmount : -parsed.absAmount, currency: parsed.currency, fee: 0 };
  }

  const parsed = parseAmountString(activity.primaryAmount);
  if (parsed) return { amount: isPositive ? parsed.absAmount : -parsed.absAmount, currency: parsed.currency, fee: 0 };

  return null;
}

export async function POST(request: Request) {
  try {
    const key = process.env.WISE_API_KEY ?? process.env.WISE_API_KEY_ACTIVEVIEW_LLC;
    if (!key) return Response.json({ error: "WISE_API_KEY not set" }, { status: 500 });

    const body = await request.json();
    const { profileId, accountId, from, to } = body as {
      profileId: string;
      accountId: string;
      from?: string;
      to?: string;
    };

    if (!profileId || !accountId) {
      return Response.json({ error: "profileId and accountId required" }, { status: 400 });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return Response.json({ error: "account not found" }, { status: 404 });

    const end = to ? `${to}T23:59:59.999Z` : new Date().toISOString();
    const start = from
      ? `${from}T00:00:00.000Z`
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const headers = { Authorization: `Bearer ${key}` };

    // Fetch borderless account to get recipientId — used to detect outgoing vs incoming transfers
    const baData = await fetchJson(`${WISE_BASE}/v1/borderless-accounts?profileId=${profileId}`, headers) as Array<{ recipientId: number }> | null;
    const ownRecipientId: number | null = Array.isArray(baData) ? (baData[0]?.recipientId ?? null) : null;

    const activities = await fetchActivities(key, profileId, start, end);
    const completed = activities.filter(a => a.status === "COMPLETED");

    const existing = await prisma.transaction.findMany({
      where: { accountId, reference: { not: null } },
      select: { reference: true },
    });
    const existingRefs = new Set(existing.map(t => t.reference));

    let parseFailCount = 0;
    const newActivities = completed.filter(a => !existingRefs.has(`wise-activity:${a.id}`));

    const candidates: Array<{
      accountId: string;
      date: Date;
      description: string;
      amount: number;
      fee: number | null;
      currency: string;
      reference: string;
      cardLast4: string | null;
      isMetaCharge: boolean;
    }> = [];

    const transferDebug: unknown[] = [];

    for (const a of newActivities) {
      let resolved: { amount: number; currency: string; fee: number } | null = null;

      if (a.resource?.type?.toUpperCase() === "TRANSFER") {
        // Debug: capture raw transfer data for suspicious transactions
        const resourceId = a.resource?.id;
        const rawTransfer = resourceId
          ? await fetchJson(`${WISE_BASE}/v1/transfers/${resourceId}`, headers) as WiseTransfer | null
          : null;
        const title = a.title.replace(/<[^>]+>/g, "").trim();
        transferDebug.push({
          title,
          activityStatus: a.status,
          activityType: a.type,
          primaryAmount: a.primaryAmount,
          transferStatus: rawTransfer?.status,
          sourceAccount: rawTransfer?.sourceAccount,
          sourceValue: rawTransfer?.sourceValue,
          sourceCurrency: rawTransfer?.sourceCurrency,
          targetValue: rawTransfer?.targetValue,
          targetCurrency: rawTransfer?.targetCurrency,
          ownRecipientId,
          detectedAs: rawTransfer?.status === "outgoing_payment_sent" || (ownRecipientId !== null && rawTransfer?.sourceAccount === ownRecipientId) ? "OUTGOING" : "INCOMING",
        });
        resolved = await resolveTransferAmount(a, profileId, ownRecipientId, headers);
      } else {
        // CARD_PAYMENT, TOPUP, etc. — use primaryAmount directly
        const isPositive = a.primaryAmount?.includes("<positive>") || a.type === "TOPUP";
        const parsed = parseAmountString(a.primaryAmount);
        if (parsed) resolved = { amount: isPositive ? parsed.absAmount : -parsed.absAmount, currency: parsed.currency, fee: 0 };
      }

      if (!resolved) {
        parseFailCount++;
        console.warn("Could not resolve amount for activity:", a.id, a.primaryAmount);
        continue;
      }

      const description = a.title.replace(/<[^>]+>/g, "").trim();

      // Cartão: para CARD_TRANSACTION, o detalhe traz cardLastDigits + merchant
      let cardLast4: string | null = null;
      let metaName = description;
      if (a.resource?.type?.toUpperCase() === "CARD_TRANSACTION" && a.resource.id) {
        const det = await fetchJson(
          `${WISE_BASE}/v3/profiles/${profileId}/card-transactions/${a.resource.id}`,
          headers,
        ) as { cardLastDigits?: string; merchant?: { name?: string } } | null;
        if (det) {
          cardLast4 = det.cardLastDigits ?? null;
          if (det.merchant?.name) metaName = det.merchant.name;
        }
      }

      candidates.push({
        accountId,
        date: new Date(a.createdOn),
        description,
        amount: resolved.amount,
        fee: resolved.fee || null,
        currency: resolved.currency,
        reference: `wise-activity:${a.id}`,
        cardLast4,
        isMetaCharge: isMetaMerchant(metaName, description),
      });
    }

    // Dedup within batch
    const seenRefs = new Set<string>();
    const toCreate = candidates.filter(tx => {
      if (seenRefs.has(tx.reference)) return false;
      seenRefs.add(tx.reference);
      return true;
    });

    if (toCreate.length > 0) {
      try {
        await prisma.transaction.createMany({ data: toCreate });
      } catch {
        for (const tx of toCreate) {
          try { await prisma.transaction.create({ data: tx }); } catch { /* skip duplicate */ }
        }
      }
    }

    await prisma.account.update({
      where: { id: accountId },
      data: { syncConfig: JSON.stringify({ wiseProfileId: profileId }) },
    });

    return Response.json({
      imported: toCreate.length,
      parseFailed: parseFailCount,
      totalCompleted: completed.length,
      transferDebug,
    });
  } catch (e) {
    console.error("Wise sync error:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
