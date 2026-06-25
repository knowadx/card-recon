import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getSyncPeriod } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/meta-charges-range — diagnóstico: onde as cobranças do Meta (MetaBillingCharge)
 * realmente começam no banco. Mostra min/max, total e contagem por dia dos primeiros dias.
 * Não chama API externa. Pra saber se "começa em 08/05" é gap de sync ou dado real.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const period = await getSyncPeriod();
  const all = await prisma.metaBillingCharge.findMany({ select: { chargedAt: true }, orderBy: { chargedAt: "asc" } });
  if (all.length === 0) return NextResponse.json({ periodoSync: period, total: 0, aviso: "MetaBillingCharge vazio" });

  const min = all[0].chargedAt;
  const max = all[all.length - 1].chargedAt;

  // contagem por dia dos 12 primeiros dias
  const porDia: Record<string, number> = {};
  for (const c of all) {
    const d = c.chargedAt.toISOString().slice(0, 10);
    porDia[d] = (porDia[d] ?? 0) + 1;
  }
  const primeirosDias = Object.entries(porDia).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 12);

  return NextResponse.json({
    periodoSync: period,
    pisoEsperado: period.from,
    total: all.length,
    primeiraCobranca: min.toISOString(),
    ultimaCobranca: max.toISOString(),
    comecaAntesDoPiso: min.toISOString().slice(0, 10) <= period.from,
    contagemPorDia_primeiros12: Object.fromEntries(primeirosDias),
  });
}
