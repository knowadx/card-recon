import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/charges-without-receipt — contas de anúncio (Meta) que têm cobrança SEM PDF na
 * pasta. "Sem PDF" = MetaBillingCharge cujo transactionId não existe em MetaReceipt.
 * Respeita o piso do período. Quebra por conta e por mês (pra ver maio×junho).
 *   ?all=1 → ignora o piso (todas as datas)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ignoreFloor = new URL(request.url).searchParams.get("all") === "1";
  const floor = await getCheckFloor();

  const [charges, receipts] = await Promise.all([
    prisma.metaBillingCharge.findMany({
      where: ignoreFloor ? {} : { chargedAt: { gte: floor } },
      select: { transactionId: true, accountId: true, accountName: true, bmName: true, chargedAt: true, amountUsd: true },
    }),
    prisma.metaReceipt.findMany({ select: { transactionId: true } }),
  ]);
  const haveReceipt = new Set(receipts.map((r) => r.transactionId));
  const round2 = (n: number) => Math.round(n * 100) / 100;

  type Acc = { accountId: string; name: string | null; bm: string | null; total: number; comPdf: number; semPdf: number; semPdfUsd: number; semPdfPorMes: Record<string, number> };
  const byAcct = new Map<string, Acc>();
  let totalSemPdf = 0;
  let usdTotal = 0;            // US$ de TODAS as cobranças no período
  let usdSemPdf = 0;          // US$ não identificado (sem PDF)
  const usdSemPdfPorMes: Record<string, number> = {};

  for (const c of charges) {
    usdTotal += c.amountUsd;
    let a = byAcct.get(c.accountId);
    if (!a) { a = { accountId: c.accountId, name: c.accountName, bm: c.bmName, total: 0, comPdf: 0, semPdf: 0, semPdfUsd: 0, semPdfPorMes: {} }; byAcct.set(c.accountId, a); }
    a.total++;
    if (haveReceipt.has(c.transactionId)) {
      a.comPdf++;
    } else {
      a.semPdf++;
      a.semPdfUsd += c.amountUsd;
      totalSemPdf++;
      usdSemPdf += c.amountUsd;
      const mes = c.chargedAt.toISOString().slice(0, 7);
      a.semPdfPorMes[mes] = (a.semPdfPorMes[mes] ?? 0) + 1;
      usdSemPdfPorMes[mes] = (usdSemPdfPorMes[mes] ?? 0) + c.amountUsd;
    }
  }

  const contasComCobrancaSemPdf = [...byAcct.values()]
    .filter((a) => a.semPdf > 0)
    .map((a) => ({ ...a, semPdfUsd: round2(a.semPdfUsd) }))
    .sort((x, y) => y.semPdfUsd - x.semPdfUsd);

  return NextResponse.json({
    piso: ignoreFloor ? "(todas as datas)" : floor.toISOString().slice(0, 10),
    totalCobrancas: charges.length,
    recibosNaPasta: receipts.length,
    totalCobrancasSemPdf: totalSemPdf,
    usdTotalPeriodo: round2(usdTotal),
    usdNaoIdentificado: round2(usdSemPdf),
    usdNaoIdentificadoPorMes: Object.fromEntries(Object.entries(usdSemPdfPorMes).map(([m, v]) => [m, round2(v)])),
    pctNaoIdentificado: usdTotal ? `${Math.round((usdSemPdf / usdTotal) * 100)}%` : "—",
    contasComTudoCoberto: byAcct.size - contasComCobrancaSemPdf.length,
    qtdeContasComCobrancaSemPdf: contasComCobrancaSemPdf.length,
    contasComCobrancaSemPdf,
  });
}
