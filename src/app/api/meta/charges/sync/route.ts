import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";
import { syncBillingCharges } from "@/lib/metaCharges";
import { runChargeMatch } from "@/lib/chargeMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/meta/charges/sync — popula cobranças reais + roda o matching. `from` opcional. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });
    const { from, to } = await request.json().catch(() => ({}));
    const since = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const until = to || undefined;

    let where: Record<string, unknown> = { issuer: "meta", isActive: true };
    if (!isSuperadmin(user.role)) {
      const h = await accessibleHoldingIds(user.id, user.role);
      const hids = h === "all" ? [] : h;
      where = { ...where, operation: { OR: [...(hids.length ? [{ holdingId: { in: hids } }] : []), { memberships: { some: { userId: user.id } } }] } };
    }
    const creds = await prisma.credential.findMany({ where, select: { token: true, operationId: true } });
    if (creds.length === 0) return NextResponse.json({ ok: false, error: "Nenhum perfil Meta conectado" }, { status: 400 });

    const synced = await syncBillingCharges(creds, since, until);
    const match = await runChargeMatch();
    return NextResponse.json({ ok: true, ...synced, since, match });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
