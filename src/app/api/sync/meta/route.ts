import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAdAccounts, fetchSpend, parseFundingDisplay } from "@/lib/meta";
import { resolvePeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync/meta?period=YYYY-MM
 * Sincroniza BMs + Contas de Anúncio (com cartão de funding) e o spend do período.
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const period = resolvePeriod(url.searchParams.get("period"));

    const { accounts, bmAvailable } = await fetchAdAccounts();

    let bmCount = 0;
    let acctCount = 0;
    let spendCount = 0;
    const seenBm = new Set<string>();

    for (const a of accounts) {
      // Business Manager
      if (a.business?.id && !seenBm.has(a.business.id)) {
        seenBm.add(a.business.id);
        await prisma.businessManager.upsert({
          where: { id: a.business.id },
          update: { name: a.business.name ?? a.business.id },
          create: { id: a.business.id, name: a.business.name ?? a.business.id },
        });
        bmCount++;
      }

      const { brand, last4 } = parseFundingDisplay(a.funding_source_details?.display_string);
      const amountSpent = a.amount_spent ? parseFloat(a.amount_spent) / 100 : 0;

      await prisma.adAccount.upsert({
        where: { id: a.id },
        update: {
          accountId: a.account_id,
          name: a.name,
          currency: a.currency,
          accountStatus: a.account_status ?? null,
          bmId: a.business?.id ?? null,
          fundingCardBrand: brand,
          fundingCardLast4: last4,
          fundingRaw: a.funding_source_details?.display_string ?? null,
          amountSpent,
        },
        create: {
          id: a.id,
          accountId: a.account_id,
          name: a.name,
          currency: a.currency,
          accountStatus: a.account_status ?? null,
          bmId: a.business?.id ?? null,
          fundingCardBrand: brand,
          fundingCardLast4: last4,
          fundingRaw: a.funding_source_details?.display_string ?? null,
          amountSpent,
        },
      });
      acctCount++;

      // Spend do período
      try {
        const spend = await fetchSpend(a.id, period.since, period.until);
        await prisma.spendSnapshot.upsert({
          where: {
            adAccountId_periodStart_periodEnd: {
              adAccountId: a.id,
              periodStart: period.start,
              periodEnd: period.end,
            },
          },
          update: { spend, currency: a.currency, fetchedAt: new Date() },
          create: {
            adAccountId: a.id,
            periodStart: period.start,
            periodEnd: period.end,
            spend,
            currency: a.currency,
          },
        });
        spendCount++;
      } catch (e) {
        // Conta sem insights/permissão não derruba o sync inteiro
        console.error(`spend falhou p/ ${a.id}:`, (e as Error).message);
      }
    }

    return NextResponse.json({
      ok: true,
      period: period.key,
      businessManagers: bmCount,
      adAccounts: acctCount,
      spendSnapshots: spendCount,
      bmAvailable,
      ...(bmAvailable
        ? {}
        : { note: "Token sem permissão 'business_management' — contas sem BM. Regere o token com esse escopo para agrupar por BM." }),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
