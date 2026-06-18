import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchControlledAccounts, parseFundingDisplay } from "@/lib/meta";
import { getCurrentUser, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";
import { syncBillingCharges } from "@/lib/metaCharges";
import { runChargeMatch } from "@/lib/chargeMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/meta/sync — "Sincronizar Meta" (tudo numa ordem só):
 *   1) contas controladas + cartão de funding + gasto (MetaAdAccount)
 *   2) cobranças reais por conta (MetaBillingCharge, via activities)
 *   3) matching extrato × cobranças (runChargeMatch)
 * Cada credencial Meta é POR OPERAÇÃO. Superadmin = todas; admin/member = escopo dele.
 */
export async function POST(request: Request) {
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
    const { from, to } = await request.json().catch(() => ({}));
    const since = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const until = to || undefined;
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
    const accessGap: { id: string; name: string }[] = []; // BMs onde o perfil não vê nenhuma conta

    for (const cred of creds) {
      const { accounts, bmAvailable, emptyBusinesses } = await fetchControlledAccounts(cred.token);
      bmAvailableAny = bmAvailableAny || bmAvailable;
      accessGap.push(...emptyBusinesses);
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

    // 2) cobranças reais por conta + 3) matching extrato × cobranças
    const charges = await syncBillingCharges(creds.map((c) => ({ token: c.token, operationId: c.operationId })), since, until);
    const check = await runChargeMatch();
    return NextResponse.json({
      ok: true,
      accounts: accountsCount,
      withFundingCard: withCard,
      bmAvailable: bmAvailableAny,
      accessGap: accessGap.map((b) => b.name), // BMs sem conta visível → precisam de acesso no Meta
      charges: charges.charges,
      accountsSemAcesso: charges.accountsErr,
      check,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
