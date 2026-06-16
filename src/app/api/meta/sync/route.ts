import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAdAccounts, parseFundingDisplay } from "@/lib/meta";
import { getCredentials } from "@/lib/credentials";
import { runMetaCheck } from "@/lib/check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/meta/sync — popula MetaAdAccount (contas controladas + cartão de funding) e roda a checagem. */
export async function POST() {
  try {
    const creds = await getCredentials("meta"); // Credential(meta) + fallback META_ACCESS_TOKEN
    if (creds.length === 0) {
      return NextResponse.json({ ok: false, error: "Sem token Meta (cadastre em /settings ou META_ACCESS_TOKEN no .env)" }, { status: 400 });
    }

    let accountsCount = 0;
    let withCard = 0;
    let bmAvailableAny = false;

    for (const cred of creds) {
      const { accounts, bmAvailable } = await fetchAdAccounts(cred.token);
      bmAvailableAny = bmAvailableAny || bmAvailable;
      for (const a of accounts) {
        const { brand, last4 } = parseFundingDisplay(a.funding_source_details?.display_string);
        if (last4) withCard++;
        await prisma.metaAdAccount.upsert({
          where: { accountId: a.account_id },
          update: {
            name: a.name,
            currency: a.currency,
            accountStatus: a.account_status ?? null,
            company: cred.company,
            bmId: a.business?.id ?? null,
            bmName: a.business?.name ?? null,
            fundingCardBrand: brand,
            fundingCardLast4: last4,
            fundingRaw: a.funding_source_details?.display_string ?? null,
          },
          create: {
            accountId: a.account_id,
            name: a.name,
            currency: a.currency,
            accountStatus: a.account_status ?? null,
            company: cred.company,
            bmId: a.business?.id ?? null,
            bmName: a.business?.name ?? null,
            fundingCardBrand: brand,
            fundingCardLast4: last4,
            fundingRaw: a.funding_source_details?.display_string ?? null,
          },
        });
        accountsCount++;
      }
    }

    const check = await runMetaCheck();
    return NextResponse.json({ ok: true, accounts: accountsCount, withFundingCard: withCard, bmAvailable: bmAvailableAny, check });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
