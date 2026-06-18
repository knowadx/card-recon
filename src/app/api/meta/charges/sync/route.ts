import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchBillingCharges } from "@/lib/meta";
import { getCurrentUser, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Roda fn sobre items com no máximo `limit` em paralelo. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * POST /api/meta/charges/sync — popula MetaBillingCharge com as cobranças reais de cada conta
 * (act_<id>/activities, ad_account_billing_charge). `from` (YYYY-MM-DD) opcional (default 90 dias).
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });
    const { from } = await request.json().catch(() => ({}));
    const since = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // credenciais Meta acessíveis (superadmin = todas; senão as da(s) holding(s)/operações do user)
    let where: Record<string, unknown> = { issuer: "meta", isActive: true };
    if (!isSuperadmin(user.role)) {
      const h = await accessibleHoldingIds(user.id, user.role);
      const hids = h === "all" ? [] : h;
      where = {
        ...where,
        operation: { OR: [...(hids.length ? [{ holdingId: { in: hids } }] : []), { memberships: { some: { userId: user.id } } }] },
      };
    }
    const creds = await prisma.credential.findMany({ where, select: { token: true, operationId: true } });
    if (creds.length === 0) return NextResponse.json({ ok: false, error: "Nenhum perfil Meta conectado" }, { status: 400 });

    let charges = 0;
    let accountsOk = 0;
    let accountsErr = 0;

    for (const cred of creds) {
      const accounts = await prisma.metaAdAccount.findMany({
        where: cred.operationId ? { operationId: cred.operationId } : {},
        select: { accountId: true, name: true, bmId: true, bmName: true, operationId: true },
      });
      await mapLimit(accounts, 6, async (a) => {
        try {
          const list = await fetchBillingCharges(cred.token, a.accountId, since);
          accountsOk++;
          for (const ch of list) {
            await prisma.metaBillingCharge.upsert({
              where: { transactionId: ch.transactionId },
              update: { amountUsd: ch.amountUsd, currency: ch.currency, chargedAt: ch.chargedAt, accountName: a.name, bmId: a.bmId, bmName: a.bmName, operationId: a.operationId },
              create: {
                transactionId: ch.transactionId,
                accountId: a.accountId,
                accountName: a.name,
                bmId: a.bmId,
                bmName: a.bmName,
                operationId: a.operationId,
                amountUsd: ch.amountUsd,
                currency: ch.currency,
                chargedAt: ch.chargedAt,
              },
            });
            charges++;
          }
        } catch {
          accountsErr++; // conta sem acesso (#200) ou erro — ignora
        }
      });
    }

    return NextResponse.json({ ok: true, charges, accountsOk, accountsErr, since });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
