import { prisma } from "@/lib/db";
import { isMetaMerchant, extractMetaRef } from "@/lib/metaCheck";
import { NO_OWN_TOKEN_MESSAGE, resolveBankToken } from "@/lib/credentials";
import { isSuperadmin } from "@/lib/auth";
import { getSyncPeriod } from "@/lib/settings";
import { assertAccount, type AppUser } from "@/lib/access";
import { mapLimit, markSynced, type SyncOutcome } from "./common";

const WISE_BASE = "https://api.wise.com";

/** Perfil Wise como a API v2 devolve (só o que usamos pra nomear). */
export interface WiseProfile {
  id: number | string;
  type?: string;
  fullName?: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  details?: { name?: string; businessName?: string; firstName?: string; lastName?: string };
}

/** Nome do perfil — a MESMA regra pra tela (lista de perfis) e pra conferência do dono. */
export function wiseProfileLabel(p: WiseProfile): string {
  return (
    p.details?.businessName ||
    p.details?.name ||
    p.businessName ||
    p.fullName ||
    p.name ||
    [p.details?.firstName ?? p.firstName, p.details?.lastName ?? p.lastName].filter(Boolean).join(" ") ||
    `Perfil ${p.id}`
  );
}

// sufixos societários não contam na comparação ("PubViews OÜ" = "PubViews")
const LEGAL_SUFFIX = new Set(["llc", "ltd", "ltda", "inc", "ou", "oy", "gmbh", "eireli"]);

/** Chave de comparação de nome de empresa: sem acento, sem caixa, sem pontuação e sem sufixo societário. */
export function companyKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_SUFFIX.has(w))
    .join("");
}

/**
 * A mesma chave Wise enxerga perfis de VÁRIAS empresas (inclusive de outro grupo). Antes de importar:
 *  - o perfil tem que ser da empresa da conta (nome igual, ignorando sufixo societário);
 *  - o perfil não pode já estar ligado a OUTRA conta (o sync traz o perfil inteiro → duplicaria).
 * Devolve o motivo da recusa, ou null se pode sincronizar. Falha fechada: sem lista de perfis, não sincroniza.
 */
export async function wiseProfileProblem(key: string, profileId: string, accountId: string, companyName: string): Promise<string | null> {
  const res = await fetch(`${WISE_BASE}/v2/profiles`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return `a Wise não listou os perfis (${res.status}) — não sincronizei`;
  const profiles = (await res.json().catch(() => [])) as WiseProfile[];
  const p = Array.isArray(profiles) ? profiles.find((x) => String(x.id) === String(profileId)) : undefined;
  if (!p) return `o perfil Wise ${profileId} não aparece para a chave desta conta`;
  const label = wiseProfileLabel(p);
  if (companyKey(label) !== companyKey(companyName)) {
    return `o perfil Wise "${label}" não é da empresa "${companyName}" — não sincronizei (evita misturar empresas)`;
  }
  const dup = await prisma.account.findFirst({
    where: { id: { not: accountId }, bank: "Wise", syncConfig: { contains: `"wiseProfileId":"${profileId}"` } },
    select: { name: true },
  });
  if (dup) return `o perfil Wise "${label}" já é sincronizado na conta "${dup.name}" — sincronizar aqui duplicaria as transações`;
  return null;
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

export type WiseSyncBody =
  | { imported: number; alreadyExisted: number; parseFailed: number; totalCompleted: number; newActivities: number }
  | { error: string };

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

/**
 * Sync de UMA conta Wise — a ÚNICA implementação (rota /api/sync/wise e /api/sync/all).
 *  - conta fora do escopo do usuário: AccessError (404);
 *  - token: resolveBankToken (o da conta / da própria empresa; legados só p/ superadmin);
 *  - pagina as atividades por nextCursor (since/until); resolve valor/taxa de transferências
 *    (transfer + cotação) e o cartão/merchant das compras no cartão;
 *  - grava cartão (últimos 4), taxa, cobrança Meta (isMetaCharge/metaRef) e a operação da conta;
 *  - saveSyncConfig: a rota lembra o perfil escolhido; o sync/all só LÊ o que está salvo.
 */
export async function syncWiseAccount(opts: {
  user: AppUser;
  accountId: string;
  profileId: string;
  from?: string | null;
  to?: string | null;
  saveSyncConfig: boolean;
}): Promise<SyncOutcome<WiseSyncBody>> {
  const { user, accountId, profileId, from, to } = opts;
  await assertAccount(user, accountId); // conta de outro grupo = 404

  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return { status: 404, body: { error: "account not found" } };

  // Token: 1º o da própria CONTA, depois fallbacks legados
  const key = await resolveBankToken("wise", account, { allowGlobal: isSuperadmin(user.role) });
  if (!key) {
    const msg = isSuperadmin(user.role) ? "Token Wise não cadastrado nesta conta" : NO_OWN_TOKEN_MESSAGE;
    return { status: 400, body: { error: msg } };
  }

  const problema = await wiseProfileProblem(key, profileId, accountId, account.company.name);
  if (problema) return { status: 400, body: { error: problema } };

  const period = await getSyncPeriod();
  const end = to ? `${to}T23:59:59.999Z` : new Date().toISOString(); // sempre até HOJE (o "até" do período não trava)
  const start = `${from || period.from}T00:00:00.000Z`;

  const headers = { Authorization: `Bearer ${key}` };

  // Fetch borderless account to get recipientId — used to detect outgoing vs incoming transfers
  const baData = await fetchJson(`${WISE_BASE}/v1/borderless-accounts?profileId=${profileId}`, headers) as Array<{ recipientId: number }> | null;
  const ownRecipientId: number | null = Array.isArray(baData) ? (baData[0]?.recipientId ?? null) : null;

  const { activities, error: actErr } = await fetchActivities(key, profileId, start, end);
  if (actErr) {
    return { status: 502, body: { error: `Wise não retornou atividades — ${actErr}. (token/perfil ou limite). Não é "0 importadas".` } };
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
    metaRef: string | null;
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
      metaRef: extractMetaRef(metaName, description),
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

  if (opts.saveSyncConfig) {
    await prisma.account.update({
      where: { id: accountId },
      data: { syncConfig: JSON.stringify({ wiseProfileId: profileId }) },
    });
  }
  await markSynced(accountId, new Date(end)); // leu a janela inteira (até hoje, ou o "to" pedido)

  return {
    status: 200,
    body: {
      imported: toCreate.length,
      alreadyExisted: Math.max(0, completed.length - toCreate.length),
      parseFailed: parseFailCount,
      totalCompleted: completed.length,
      newActivities: newActivities.length,
    },
  };
}
