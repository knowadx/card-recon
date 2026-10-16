import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSuperadmin, scopes } from "@/lib/auth";
import { assertCompany, companyScope, guarded, requireUser, transactionScope } from "@/lib/access";
import { getSyncPeriod } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/fechamento?month=YYYY-MM — status dos passos do fechamento do mês.
 * Diz o que já foi feito e o que falta, pra a página guiada mostrar ✓/pendente.
 */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  // empresa fora do escopo = 404 (não confirma que existe)
  const companyParam = params.get("company") || "";
  if (companyParam) await assertCompany(user, companyParam);

  const period = await getSyncPeriod();
  const floor = new Date(`${period.from}T00:00:00.000Z`);
  const ceiling = period.to ? new Date(`${period.to}T23:59:59.999Z`) : new Date();
  const meses: string[] = [];
  for (let d = new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), 1)); d <= ceiling; d.setUTCMonth(d.getUTCMonth() + 1)) meses.push(d.toISOString().slice(0, 7));
  meses.reverse();

  // empresas que o usuário enxerga (pra o seletor de escopo)
  const companies = await prisma.company.findMany({ where: await companyScope(user), select: { id: true, name: true }, orderBy: { name: "asc" } });

  const month = params.get("month") && /^\d{4}-\d{2}$/.test(params.get("month")!) ? params.get("month")! : meses[0];
  if (!month) return NextResponse.json({ mesesDisponiveis: meses, companies, month: null });

  // escopo: 1 empresa selecionada (já conferida acima) e, sempre, só as transações do grupo do usuário
  const accountWhere = companyParam ? { companyId: { in: [companyParam] } } : undefined;

  const mStart = new Date(`${month}-01T00:00:00.000Z`);
  const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
  const dateRange = { gte: mStart, lt: mEnd };

  const bankBase = { isMetaCharge: true, date: dateRange, AND: [await transactionScope(user)], ...(accountWhere ? { account: accountWhere } : {}) };
  // cobranças Meta: por operação (como antes) — superadmin vê todas; os demais, só as das operações em que são membros
  const metaScope = isSuperadmin(user.role) ? {} : { operationId: { in: (await scopes(user.id)).operationIds } };

  const [bancoMeta, revolutSemCodigo, comFatura, semFatura, metaCobrancas] = await Promise.all([
    prisma.transaction.count({ where: bankBase }),
    prisma.transaction.count({ where: { ...bankBase, metaRef: null, account: { ...(accountWhere ?? {}), bank: "Revolut" } } }),
    prisma.transaction.count({ where: { ...bankBase, hasReceipt: true } }),
    prisma.transaction.count({ where: { ...bankBase, hasReceipt: false } }),
    prisma.metaBillingCharge.count({ where: { chargedAt: dateRange, ...metaScope } }),
  ]);

  return NextResponse.json({
    mesesDisponiveis: meses,
    companies,
    company: companyParam || null,
    month,
    passos: {
      bancos: { transacoesMeta: bancoMeta, feito: bancoMeta > 0 },
      revolutCsv: { semCodigo: revolutSemCodigo, feito: revolutSemCodigo === 0 && bancoMeta > 0 },
      meta: { cobrancas: metaCobrancas, feito: metaCobrancas > 0 },
      faturas: { comFatura, semFatura, feito: bancoMeta > 0 && semFatura === 0 },
    },
    resultado: { totalMeta: bancoMeta, semFatura, comFatura },
  });
});
