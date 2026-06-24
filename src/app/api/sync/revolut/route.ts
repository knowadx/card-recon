import { prisma } from "@/lib/db";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";
import { isMetaMerchant, last4Of, extractMetaRef } from "@/lib/metaCheck";

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
    bill_amount?: number; // valor cobrado na moeda de cobrança (geralmente USD na Meta)
    bill_currency?: string;
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

  // Nomes dos cartões (label, ex.: "BM 14 Snapnork") → mapa por últimos 4 dígitos.
  // Se 2+ cartões compartilham o mesmo final, junta os nomes (o "provável").
  const cardLabelByLast4 = new Map<string, string>();
  try {
    const cr = await fetchWith429Retry(`${REVOLUT_BASE}/cards`, { headers });
    if (cr.ok) {
      const raw = await cr.json();
      const cards: Array<{ last_digits?: string; label?: string; name?: string }> = Array.isArray(raw) ? raw : raw?.cards ?? [];
      for (const card of cards) {
        const l4 = card.last_digits;
        const label = card.label || card.name;
        if (!l4 || !label) continue;
        const prev = cardLabelByLast4.get(l4);
        cardLabelByLast4.set(l4, prev && !prev.includes(label) ? `${prev} / ${label}` : prev || label);
      }
    }
  } catch { /* /cards pode não estar disponível — segue sem label */ }

  // Fetch all transactions with pagination
  // refs já existentes (evita duplicar). Carregado 1x; novos refs são somados conforme grava.
  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const seenRefs = new Set(existing.map(t => t.reference));

  // Converte um lote da Graph em candidatos novos (pula os já vistos nesta run e os existentes).
  const toCandidates = (batch: RevolutTransaction[]) =>
    batch
      .filter(tx => tx.state === "completed" || tx.state === "COMPLETED")
      .flatMap(tx =>
        tx.legs
          .filter(leg => !revolutAccountId || leg.account_id === revolutAccountId)
          .map(leg => {
            const ref = `revolut:${tx.id}:${leg.leg_id}`;
            if (seenRefs.has(ref)) return null;
            seenRefs.add(ref);
            const fee = leg.fee ?? 0;
            const totalAmount = leg.amount < 0 ? leg.amount - fee : leg.amount;
            return {
              accountId,
              date: new Date(tx.completed_at ?? tx.created_at),
              description: tx.merchant?.name || leg.counterparty?.name || leg.description || tx.reference || "Revolut",
              amount: totalAmount,
              fee,
              currency: leg.currency,
              reference: ref,
              cardLast4: last4Of(tx.card?.last_digits ?? tx.card?.card_number),
              cardLabel: (() => { const l4 = last4Of(tx.card?.last_digits ?? tx.card?.card_number); return l4 ? cardLabelByLast4.get(l4) ?? null : null; })(),
              isMetaCharge: isMetaMerchant(tx.merchant?.name, leg.counterparty?.name, leg.description),
              metaRef: extractMetaRef(tx.merchant?.name, leg.description, leg.counterparty?.name, tx.reference),
              operationId: account.operationId,
              billAmount: leg.bill_amount != null ? Math.abs(leg.bill_amount) : null,
              billCurrency: leg.bill_currency ?? null,
            };
          })
          .filter(Boolean) as Array<{ accountId: string; date: Date; description: string; amount: number; fee: number; currency: string; reference: string; cardLast4: string | null; cardLabel: string | null; isMetaCharge: boolean; metaRef: string | null; operationId: string | null; billAmount: number | null; billCurrency: string | null }>,
      );

  // Salva syncConfig logo de cara (não depende de terminar a paginação)
  await prisma.account.update({ where: { id: accountId }, data: { syncConfig: JSON.stringify({ revolutAccountId: revolutAccountId ?? null }) } });

  // Pagina e GRAVA por página — resiliente a volume/timeout/429 e retomável (refs duplicados são pulados).
  let imported = 0;
  let fetched = 0;
  // Paginação Revolut: mover a janela pelo `to` (created_at mais antigo da página anterior).
  // ⚠️ O Revolut IGNORA `created_before` quando `to` também é enviado (volta sempre as mais
  // recentes) — verificado na API. Por isso paginamos só com `to`, sem `created_before`.
  let cursorTo: string = toDate;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${REVOLUT_BASE}/transactions`);
    url.searchParams.set("from", `${fromDate}T00:00:00Z`);
    url.searchParams.set("to", cursorTo);
    url.searchParams.set("count", "1000");

    const res = await fetchWith429Retry(url.toString(), { headers });
    if (!res.ok) {
      // o que já gravou persiste — basta rodar de novo p/ continuar
      const msg = res.status === 429
        ? `Revolut limitou (429) após importar ${imported}. Aguarde uns minutos e rode de novo — ele continua de onde parou.`
        : `Revolut API ${res.status} após importar ${imported}: ${(await res.text()).slice(0, 200)}`;
      return Response.json({ error: msg, imported, partial: true }, { status: res.status === 429 ? 429 : 502 });
    }

    const batch: RevolutTransaction[] = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    fetched += batch.length;

    const cands = toCandidates(batch);
    if (cands.length > 0) {
      await prisma.transaction.createMany({ data: cands });
      imported += cands.length;
    }

    // Backfill do valor USD (bill_amount) nas cobranças de cartão JÁ existentes (sem billAmount).
    // Necessário p/ o matching extrato × cobranças Meta (que é em USD).
    for (const tx of batch) {
      for (const leg of tx.legs) {
        if (leg.bill_amount == null) continue;
        await prisma.transaction.updateMany({
          where: { accountId, reference: `revolut:${tx.id}:${leg.leg_id}`, billAmount: null },
          data: { billAmount: Math.abs(leg.bill_amount), billCurrency: leg.bill_currency ?? null },
        });
      }
    }

    if (batch.length < 1000) break;
    const oldest = batch[batch.length - 1].created_at;
    if (oldest === cursorTo) break; // janela não avançou → evita loop infinito
    cursorTo = oldest;
  }

  // Aplica o nome do cartão também nas transações já existentes desta conta (por últimos 4).
  for (const [l4, label] of cardLabelByLast4) {
    await prisma.transaction.updateMany({ where: { accountId, cardLast4: l4 }, data: { cardLabel: label } });
  }

  return Response.json({ imported, fetched, skipped: Math.max(0, fetched - imported), cardsLabeled: cardLabelByLast4.size });
}
