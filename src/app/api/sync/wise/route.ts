import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchProfiles,
  fetchActivities,
  fetchCardTransaction,
  parseAmount,
  stripTags,
} from "@/lib/wise";
import { resolvePeriod } from "@/lib/period";
import { getMetaMerchantPattern } from "@/lib/settings";
import { getCredentials } from "@/lib/credentials";

export const dynamic = "force-dynamic";

/** POST /api/sync/wise?period=YYYY-MM — activities + card-transaction detail (sem SCA). */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const period = resolvePeriod(url.searchParams.get("period"));
    const metaRe = await getMetaMerchantPattern();

    const since = period.start.toISOString();
    const until = new Date(period.end.getTime() + 86399999).toISOString();

    const creds = await getCredentials("wise");
    if (creds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nenhuma credencial Wise — cadastre em /settings ou defina WISE_API_TOKEN no .env." },
        { status: 400 },
      );
    }

    const perCompany: Record<string, unknown> = {};

    for (const cred of creds) {
      const { company, token, secrets } = cred;
      const profiles = secrets.profileId
        ? [{ id: Number(secrets.profileId), type: "BUSINESS" }]
        : await fetchProfiles(token);

      let chargeCount = 0;
      let metaCount = 0;
      let metaCardCount = 0;
      const cardLast4s = new Set<string>();

      for (const p of profiles) {
        const activities = await fetchActivities(token, p.id, since, until);
        for (const a of activities) {
          if (a.status !== "COMPLETED") continue;
          // <positive> = crédito/entrada; só queremos saídas (cobranças)
          if (a.primaryAmount?.includes("<positive>")) continue;

          let merchant = stripTags(a.title);
          let last4: string | null = null;
          let amount: number | null = null;
          let currency = "USD";
          let when = new Date(a.createdOn);

          if (a.type === "CARD_PAYMENT" && a.resource?.id) {
            const det = await fetchCardTransaction(token, p.id, a.resource.id);
            if (det) {
              last4 = det.cardLastDigits ?? null;
              merchant = det.merchant?.name ?? merchant;
              amount = det.transactionAmount?.amount ?? null;
              currency = det.transactionAmount?.currency ?? currency;
              if (det.createdDate) when = new Date(det.createdDate);
              if (last4) cardLast4s.add(last4);
            }
          }
          if (amount == null) {
            const parsed = parseAmount(a.primaryAmount);
            if (parsed) {
              amount = parsed.amount;
              currency = parsed.currency;
            }
          }
          if (amount == null) continue;

          const isMeta = metaRe.test(merchant);
          const bankTxId = `activity:${a.id}`;

          await prisma.bankCharge.upsert({
            where: { issuer_bankTxId: { issuer: "wise", bankTxId } },
            update: {
              date: when,
              amount: Math.abs(amount),
              currency,
              merchantRaw: merchant || null,
              cardLast4: last4,
              isMetaCharge: isMeta,
              company,
            },
            create: {
              issuer: "wise",
              bankTxId,
              date: when,
              amount: Math.abs(amount),
              currency,
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

      for (const last4 of cardLast4s) {
        await prisma.card.upsert({
          where: { issuer_bankCardId: { issuer: "wise", bankCardId: last4 } },
          update: { last4, company },
          create: { issuer: "wise", bankCardId: last4, last4, brand: "Wise", company },
        });
      }

      perCompany[company] = {
        cards: cardLast4s.size,
        charges: chargeCount,
        metaCharges: metaCount,
        metaChargesWithCard: metaCardCount,
      };
    }

    return NextResponse.json({ ok: true, period: period.key, companies: creds.length, perCompany });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
