import { prisma } from "@/lib/db";
import { isMetaMerchant } from "@/lib/metaCheck";
import { getCredentialToken } from "@/lib/credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WISE_BASE = "https://api.wise.com";

/** Roda fn sobre items com no máximo `limit` em paralelo (preserva a ordem). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

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
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    console.warn("Wise fetch falhou/timeout:", url, String(e));
    return null;
  }
  const text = await res.text();
  if (!res.ok) {
    console.warn(`Wise ${res.status} em ${url}: ${text.slice(0, 200)}`);
    return null;
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchActivities(
  key: string,
  profileId: string,
  start: string,
  end: string
): Promise<{ activities: WiseActivity[]; error: string | null }> {
  const all: WiseActivity[] = [];
  let nextCursor: string | null = null;
  let page = 0;
  let error: string | null = null;

  while (page < 50) {
    page++;
    const url = new URL(`${WISE_BASE}/v1/profiles/${profileId}/activities`);
    url.searchParams.set("size", "100");
    url.searchParams.set("since", start);
    url.searchParams.set("until", end);
    if (nextCursor) url.searchParams.set("nextCursor", nextCursor);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      error = `falha/timeout ao buscar atividades (${String(e)})`;
      break;
    }
    if (!res.ok) {
      error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      break;
    }

    const data = await res.json();
    const activities: WiseActivity[] = data.activities ?? [];
    all.push(...activities);

    nextCursor = typeof data.cursor === "string" ? data.cursor : null;
    if (!nextCursor || activities.length === 0) break;
  }

  // só reporta erro se NADA veio (erro logo na 1ª página); páginas parciais seguem com o que tem
  return { activities: all, error: all.length === 0 ? error : null };
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

    const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
    if (!account) return Response.json({ error: "account not found" }, { status: 404 });

    // Token: 1º o da própria CONTA, depois fallbacks legados
    const key =
      account.apiToken ||
      (await getCredentialToken("wise", account.company?.name)) ||
      process.env.WISE_API_KEY ||
      process.env.WISE_API_KEY_ACTIVEVIEW_LLC;
    if (!key) return Response.json({ error: "Token Wise não cadastrado nesta conta" }, { status: 400 });

    const end = to ? `${to}T23:59:59.999Z` : new Date().toISOString();
    const start = from
      ? `${from}T00:00:00.000Z`
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const headers = { Authorization: `Bearer ${key}` };

    // Fetch borderless account to get recipientId — used to detect outgoing vs incoming transfers
    const baData = await fetchJson(`${WISE_BASE}/v1/borderless-accounts?profileId=${profileId}`, headers) as Array<{ recipientId: number }> | null;
    const ownRecipientId: number | null = Array.isArray(baData) ? (baData[0]?.recipientId ?? null) : null;

    const { activities, error: actErr } = await fetchActivities(key, profileId, start, end);
    if (actErr) {
      return Response.json({ error: `Wise não retornou atividades — ${actErr}. (token/perfil ou limite). Não é "0 importadas".` }, { status: 502 });
    }
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
      operationId: string | null;
    }> = [];

    type Candidate = (typeof candidates)[number];

    // Processa cada atividade (até 8 em paralelo) — a maioria precisa de chamadas extra ao Wise
    // (resolver valor da transferência / detalhe do cartão). Sequencial isso "rodava eternamente".
    const processed = await mapLimit(newActivities, 8, async (a): Promise<Candidate | null> => {
      let resolved: { amount: number; currency: string; fee: number } | null = null;

      if (a.resource?.type?.toUpperCase() === "TRANSFER") {
        resolved = await resolveTransferAmount(a, profileId, ownRecipientId, headers);
      } else {
        // CARD_PAYMENT, TOPUP, etc. — use primaryAmount directly
        const isPositive = a.primaryAmount?.includes("<positive>") || a.type === "TOPUP";
        const parsed = parseAmountString(a.primaryAmount);
        if (parsed) resolved = { amount: isPositive ? parsed.absAmount : -parsed.absAmount, currency: parsed.currency, fee: 0 };
      }

      if (!resolved) {
        console.warn("Could not resolve amount for activity:", a.id, a.primaryAmount);
        return null;
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

      return {
        accountId,
        date: new Date(a.createdOn),
        description,
        amount: resolved.amount,
        fee: resolved.fee || null,
        currency: resolved.currency,
        reference: `wise-activity:${a.id}`,
        cardLast4,
        isMetaCharge: isMetaMerchant(metaName, description),
        operationId: account.operationId,
      };
    });

    for (const r of processed) {
      if (r) candidates.push(r);
      else parseFailCount++;
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
      alreadyExisted: Math.max(0, completed.length - toCreate.length),
      parseFailed: parseFailCount,
      totalCompleted: completed.length,
      newActivities: newActivities.length,
    });
  } catch (e) {
    console.error("Wise sync error:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
