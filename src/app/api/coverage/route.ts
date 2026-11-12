import { prisma } from "@/lib/db";
import { AccessError, accountScope, companyScope, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { cobertaAte, coberturaDoMes, coberturaPorConta, inicioDoMes } from "@/lib/cobertura";

/**
 * Control — o que já foi importado e categorizado, por conta e mês (decisão do dono em 2026-10-30:
 * "nunca consigo saber exatamente o que já importei. Qual conta eu importei, e qual mês"). Dois
 * checkpoints SEPARADOS e só calculados (ninguém marca):
 *  - importação: a COBERTURA da conta no mês (src/lib/cobertura.ts) — contagem de lançamentos não prova;
 *  - categorização: lançamentos do mês sem categoria gerencial.
 * Estados da importação no mês: completo · parcial (trechos) · sem_comprovacao (tem lançamento mas
 * nenhuma importação registrada cobre) · faltando (nada) · antes (a conta ainda não tinha dado nenhum).
 * Superadmin vê todas as empresas; admin só as do grupo dele; member não vê (decisão de 2026-10-16).
 */

type EstadoImp = "completo" | "parcial" | "sem_comprovacao" | "faltando" | "antes";
type Mes = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number };

export const GET = guarded(async () => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores veem o Control");

  const now = new Date();
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const desde = inicioDoMes(months[0]);

  const companies = await prisma.company.findMany({
    where: await companyScope(user),
    select: { id: true, name: true, color: true, accounts: { where: await accountScope(user), select: { id: true, name: true, bank: true, syncConfig: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  const contas = companies.flatMap((c) => c.accounts.map((a) => ({ ...a, companyId: c.id })));
  const ids = contas.map((a) => a.id);

  const [coberturas, porMes, primeiras, ultimas] = await Promise.all([
    coberturaPorConta(ids),
    ids.length
      ? prisma.$queryRaw<Array<{ accountId: string; mes: string; total: number; sem_categoria: number }>>`
          SELECT t."accountId", to_char(date_trunc('month', t."date"), 'YYYY-MM') AS mes, count(*)::int AS total,
                 count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM "TransactionSplit" s WHERE s."transactionId" = t."id" AND s."managerialCategoryId" IS NOT NULL
                 ))::int AS sem_categoria
            FROM "Transaction" t
           WHERE t."accountId" = ANY(${ids}) AND t."ignored" = false AND t."date" >= ${desde}
           GROUP BY 1, 2`
      : [],
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _min: { date: true } }),
    // última importação de cada conta: quando, quem, de onde
    ids.length
      ? prisma.importCoverage.findMany({
          where: { accountId: { in: ids } },
          orderBy: { createdAt: "desc" },
          distinct: ["accountId"],
          select: { accountId: true, createdAt: true, source: true, user: { select: { name: true, email: true } }, importLog: { select: { filename: true } } },
        })
      : [],
  ]);

  const contagem = new Map(porMes.map((r) => [`${r.accountId}|${r.mes}`, r]));
  const contasOut = contas.map((a) => {
    const trechos = coberturas.get(a.id) ?? [];
    const primeiroDado = [trechos[0]?.de, primeiras.find((p) => p.accountId === a.id)?._min.date].filter(Boolean).sort((x, y) => x!.getTime() - y!.getTime())[0] ?? null;
    const meses: Record<string, Mes> = {};
    for (const m of months) {
      const c = contagem.get(`${a.id}|${m}`);
      const total = c?.total ?? 0;
      const semCategoria = c?.sem_categoria ?? 0;
      const cob = coberturaDoMes(trechos, m);
      let imp: EstadoImp;
      if (cob.estado === "completo") imp = "completo";
      else if (cob.estado === "parcial") imp = "parcial";
      else if (total > 0) imp = "sem_comprovacao";
      else if (!primeiroDado || primeiroDado >= new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1))) imp = "antes";
      else imp = "faltando";
      meses[m] = {
        imp, total, semCategoria,
        ...(cob.estado === "parcial" ? { pedacos: cob.pedacos.map((p) => ({ de: p.de.toISOString(), ate: p.ate.toISOString() })) } : {}),
      };
    }
    const ult = ultimas.find((u) => u.accountId === a.id);
    return {
      id: a.id, name: a.name, bank: a.bank, companyId: a.companyId,
      fonte: ult?.source ?? (a.syncConfig ? "api" : null),
      nuncaImportada: !primeiroDado,
      cobertaAte: cobertaAte(trechos)?.toISOString() ?? null,
      ultimaImportacao: ult ? { quando: ult.createdAt.toISOString(), quem: ult.user?.name || ult.user?.email || null, fonte: ult.source, arquivo: ult.importLog?.filename ?? null } : null,
      meses,
    };
  });

  return Response.json({
    months,
    companies: companies.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    accounts: contasOut,
  });
});
