import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getValidAccessToken, fetchCards, fetchTransactions, extractCardLast4 } from "@/lib/revolut";
import { resolvePeriod } from "@/lib/period";
import { getMetaMerchantPattern } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** POST /api/sync/revolut?period=YYYY-MM — itera as empresas Revolut cadastradas. */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const period = resolvePeriod(url.searchParams.get("period"));
    const metaRe = await getMetaMerchantPattern();

    const creds = await prisma.credential.findMany({ where: { issuer: "revolut", isActive: true } });
    if (creds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nenhuma empresa Revolut — registre via /api/revolut/auth?company=&client_id= e consinta." },
        { status: 400 },
      );
    }

    const from = period.start.toISOString();
    const to = new Date(period.end.getTime() + 86399999).toISOString();
    const perCompany: Record<string, unknown> = {};

    for (const cred of creds) {
      const company = cred.company;
      let token: string;
      try {
        token = await getValidAccessToken(company);
      } catch (e) {
        perCompany[company] = { ok: false, error: (e as Error).message };
        continue;
      }

      const cards = await fetchCards(token);
      let cardCount = 0;
      for (const c of cards) {
        if (!c.last_digits) continue;
        await prisma.card.upsert({
          where: { issuer_bankCardId: { issuer: "revolut", bankCardId: c.id } },
          update: { last4: c.last_digits, label: c.label ?? null, state: c.state ?? null, brand: "Revolut", company },
          create: {
            issuer: "revolut",
            bankCardId: c.id,
            last4: c.last_digits,
            label: c.label ?? null,
            state: c.state ?? null,
            brand: "Revolut",
            company,
          },
        });
        cardCount++;
      }

      const txs = await fetchTransactions(token, from, to);
      let chargeCount = 0;
      let metaCount = 0;
      let metaCardCount = 0;
      for (const tx of txs) {
        if (tx.state && tx.state !== "completed") continue;
        const leg = tx.legs?.[0];
        const amount = leg?.amount ?? 0;
        if (amount >= 0) continue;
        const merchant = tx.merchant?.name ?? leg?.description ?? "";
        const isMeta = metaRe.test(merchant);
        const last4 = extractCardLast4(tx);

        await prisma.bankCharge.upsert({
          where: { issuer_bankTxId: { issuer: "revolut", bankTxId: tx.id } },
          update: {
            date: new Date(tx.completed_at ?? tx.created_at ?? period.start),
            amount: Math.abs(amount),
            currency: leg?.currency ?? "EUR",
            merchantRaw: merchant || null,
            cardLast4: last4,
            isMetaCharge: isMeta,
            company,
          },
          create: {
            issuer: "revolut",
            bankTxId: tx.id,
            date: new Date(tx.completed_at ?? tx.created_at ?? period.start),
            amount: Math.abs(amount),
            currency: leg?.currency ?? "EUR",
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

      perCompany[company] = { cards: cardCount, charges: chargeCount, metaCharges: metaCount, metaChargesWithCard: metaCardCount };
    }

    return NextResponse.json({ ok: true, period: period.key, companies: creds.length, perCompany });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
