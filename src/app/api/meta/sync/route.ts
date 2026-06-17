import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAdAccounts, parseFundingDisplay } from "@/lib/meta";
import { getCurrentUser, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";
import { runMetaCheck } from "@/lib/check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/meta/sync — popula MetaAdAccount (contas controladas + cartão de funding) e roda a checagem.
 * Cada credencial Meta é POR OPERAÇÃO. Admin sincroniza todas; operador só as operações dele.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });

    // superadmin sincroniza todas; admin = ops da(s) holding(s) dele ou que é membro; member = as que é membro
    let where: Record<string, unknown> = { issuer: "meta", isActive: true };
    if (!isSuperadmin(user.role)) {
      const holdings = await accessibleHoldingIds(user.id, user.role);
      const hids = holdings === "all" ? [] : holdings;
      where = {
        ...where,
        operation: {
          OR: [
            ...(hids.length ? [{ holdingId: { in: hids } }] : []),
            { memberships: { some: { userId: user.id } } },
          ],
        },
      };
    }
    const creds = await prisma.credential.findMany({
      where,
      select: { token: true, company: true, operationId: true },
    });
    if (creds.length === 0) {
      return NextResponse.json({ ok: false, error: "Nenhum perfil Meta conectado (conecte em Operações)" }, { status: 400 });
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
        const data = {
          name: a.name,
          currency: a.currency,
          accountStatus: a.account_status ?? null,
          company: cred.company,
          operationId: cred.operationId,
          bmId: a.business?.id ?? null,
          bmName: a.business?.name ?? null,
          fundingCardBrand: brand,
          fundingCardLast4: last4,
          fundingRaw: a.funding_source_details?.display_string ?? null,
          amountSpent: a.amount_spent != null ? Number(a.amount_spent) : null,
        };
        await prisma.metaAdAccount.upsert({
          where: { accountId: a.account_id },
          update: data,
          create: { accountId: a.account_id, ...data },
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
