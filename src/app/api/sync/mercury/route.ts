import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchAccounts,
  fetchCards,
  fetchAccountTransactions,
  extractCardId,
} from "@/lib/mercury";
import { resolvePeriod } from "@/lib/period";
import { getMetaMerchantPattern } from "@/lib/settings";
import { getCredentials } from "@/lib/credentials";

export const dynamic = "force-dynamic";

/** POST /api/sync/mercury?period=YYYY-MM — itera 1 token por empresa. */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const period = resolvePeriod(url.searchParams.get("period"));
    const metaRe = await getMetaMerchantPattern();

    const creds = await getCredentials("mercury");
    if (creds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nenhuma credencial Mercury — cadastre em /settings ou defina MERCURY_API_TOKEN no .env." },
        { status: 400 },
      );
    }

    const perCompany: Record<string, unknown> = {};

    for (const cred of creds) {
      const { company, token } = cred;
      const accounts = await fetchAccounts(token);

      // 1) Cartões → registro + mapa cardId(UUID) → last4
      const idToLast4 = new Map<string, string>();
      let cardCount = 0;
      for (const acc of accounts) {
        let cards;
        try {
          cards = await fetchCards(token, acc.id);
        } catch {
          continue;
        }
        for (const c of cards) {
          const last4 = c.lastFourDigits ?? c.last4;
          const bankCardId = c.cardId ?? c.id;
          if (!last4 || !bankCardId) continue;
          idToLast4.set(bankCardId, last4);
          await prisma.card.upsert({
            where: { issuer_bankCardId: { issuer: "mercury", bankCardId } },
            update: { last4, brand: c.network ?? null, label: c.nickname ?? null, state: c.status ?? null, company },
            create: {
              issuer: "mercury",
              bankCardId,
              last4,
              brand: c.network ?? null,
              label: c.nickname ?? null,
              state: c.status ?? null,
              company,
            },
          });
          cardCount++;
        }
      }

      // 2) Transações por conta, filtradas pelo período
      let chargeCount = 0;
      let metaCount = 0;
      let metaCardCount = 0;
      for (const acc of accounts) {
        const txs = await fetchAccountTransactions(token, acc.id);
        for (const tx of txs) {
          const when = new Date(tx.postedAt ?? tx.createdAt);
          if (when < period.start || when > period.end) continue;
          if (tx.amount >= 0) continue; // só saídas (cobranças)

          const merchant = tx.counterpartyName ?? tx.bankDescription ?? "";
          const isMeta = metaRe.test(merchant) || metaRe.test(tx.bankDescription ?? "");
          const cardId = extractCardId(tx);
          const last4 = cardId ? idToLast4.get(cardId) ?? null : null;

          await prisma.bankCharge.upsert({
            where: { issuer_bankTxId: { issuer: "mercury", bankTxId: tx.id } },
            update: {
              date: when,
              amount: Math.abs(tx.amount),
              currency: "USD",
              merchantRaw: merchant || null,
              cardLast4: last4,
              isMetaCharge: isMeta,
              company,
            },
            create: {
              issuer: "mercury",
              bankTxId: tx.id,
              date: when,
              amount: Math.abs(tx.amount),
              currency: "USD",
              merchantRaw: merchant || null,
              cardLast4: last4,
              isMetaCharge: isMeta,
              company,
            },
          });
          chargeCount++;
          if (isMeta) {
            metaCount++;
            if (last4) metaCardCount++;
          }
        }
      }

      perCompany[company] = { cards: cardCount, charges: chargeCount, metaCharges: metaCount, metaChargesWithCard: metaCardCount };
    }

    return NextResponse.json({ ok: true, period: period.key, companies: creds.length, perCompany });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
