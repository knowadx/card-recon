import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds, sessionScopes } from "@/lib/auth";
import { getSyncPeriod } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/fechamento?month=YYYY-MM — status dos passos do fechamento do mês.
 * Diz o que já foi feito e o que falta, pra a página guiada mostrar ✓/pendente.
 */
export async function GET(request: Request) {
  const scope = await scopedCompanyIds();
  const sc = await sessionScopes();
  const params = new URL(request.url).searchParams;

  const period = await getSyncPeriod();
  const floor = new Date(`${period.from}T00:00:00.000Z`);
  const ceiling = period.to ? new Date(`${period.to}T23:59:59.999Z`) : new Date();
  const meses: string[] = [];
  for (let d = new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), 1)); d <= ceiling; d.setUTCMonth(d.getUTCMonth() + 1)) meses.push(d.toISOString().slice(0, 7));
  meses.reverse();

  const month = params.get("month") && /^\d{4}-\d{2}$/.test(params.get("month")!) ? params.get("month")! : meses[0];
  if (!month) return NextResponse.json({ mesesDisponiveis: meses, month: null });

  const mStart = new Date(`${month}-01T00:00:00.000Z`);
  const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
  const dateRange = { gte: mStart, lt: mEnd };

  const accountWhere = scope === "all" ? undefined : { companyId: { in: scope } };
  const bankBase = { isMetaCharge: true, date: dateRange, ...(accountWhere ? { account: accountWhere } : {}) };

  const [bancoMeta, revolutSemCodigo, comFatura, semFatura, metaCobrancas] = await Promise.all([
    prisma.transaction.count({ where: bankBase }),
    prisma.transaction.count({ where: { ...bankBase, metaRef: null, account: { ...(accountWhere ?? {}), bank: "Revolut" } } }),
    prisma.transaction.count({ where: { ...bankBase, hasReceipt: true } }),
    prisma.transaction.count({ where: { ...bankBase, hasReceipt: false } }),
    prisma.metaBillingCharge.count({ where: { chargedAt: dateRange, ...(sc.isAdmin ? {} : { operationId: { in: sc.operationIds } }) } }),
  ]);

  return NextResponse.json({
    mesesDisponiveis: meses,
    month,
    passos: {
      bancos: { transacoesMeta: bancoMeta, feito: bancoMeta > 0 },
      revolutCsv: { semCodigo: revolutSemCodigo, feito: revolutSemCodigo === 0 && bancoMeta > 0 },
      meta: { cobrancas: metaCobrancas, feito: metaCobrancas > 0 },
      faturas: { comFatura, semFatura, feito: bancoMeta > 0 && semFatura === 0 },
    },
    resultado: { totalMeta: bancoMeta, semFatura, comFatura },
  });
}
