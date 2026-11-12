import { prisma } from "@/lib/db";
import { AccessError, accountScope, companyScope, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { cobertaAte, coberturaDoMes, coberturaPorConta, inicioDoMes } from "@/lib/cobertura";
import { INICIO_DOS_FECHAMENTOS } from "@/lib/mesFechado";
import { EXTRACAO_CHAVES } from "@/lib/sync/common";

/**
 * Control — o que já foi importado e categorizado, por conta e mês (decisão do dono em 2026-10-30:
 * "nunca consigo saber exatamente o que já importei. Qual conta eu importei, e qual mês"). Dois
 * checkpoints SEPARADOS e só calculados (ninguém marca):
 *  - importação: a COBERTURA da conta no mês (src/lib/cobertura.ts) — contagem de lançamentos não prova;
 *  - categorização: lançamentos do mês sem categoria gerencial (e os categorizados = total − pendentes);
 *  - comprovante: lançamentos com anexo OU com a fatura Meta casada (pedido do dono em 2026-11-12) — só
 *    informa, não entra no "mês fechado".
 * Estados da importação no mês: completo · parcial (trechos) · sem_comprovacao (tem lançamento mas
 * nenhuma importação registrada cobre) · faltando (nada) · antes (a conta ainda não tinha dado nenhum).
 * Meses: de INICIO_DOS_FECHAMENTOS até o atual. Superadmin vê todas as empresas; admin só as do grupo dele;
 * member não vê (decisão de 2026-10-16).
 */

type EstadoImp = "completo" | "parcial" | "sem_comprovacao" | "faltando" | "antes";
type Mes = { imp: EstadoImp; pedacos?: Array<{ de: string; ate: string }>; total: number; semCategoria: number; comComprovante: number };

/** Id da extração gravada no syncConfig (uma chave por banco — src/lib/sync/common.ts). */
function extracaoDe(syncConfig: string | null): string | null {
  try {
    const c = syncConfig ? JSON.parse(syncConfig) : {};
    const v = EXTRACAO_CHAVES.map((k) => c[k]).find((x) => x != null);
    return v == null ? null : String(v);
  } catch { return null; }
}

export const GET = guarded(async () => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores veem o Control");

  // do 1º mês dos fechamentos até o mês atual
  const months: string[] = [];
  const agora = new Date().toISOString().slice(0, 7);
  for (let d = inicioDoMes(INICIO_DOS_FECHAMENTOS); d.toISOString().slice(0, 7) <= agora; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(d.toISOString().slice(0, 7));
  }
  const desde = inicioDoMes(months[0]);

  const companies = await prisma.company.findMany({
    where: await companyScope(user),
    select: { id: true, name: true, color: true, accounts: { where: await accountScope(user), select: { id: true, name: true, bank: true, currency: true, syncConfig: true }, orderBy: [{ bank: "asc" }, { name: "asc" }] } },
    orderBy: { name: "asc" },
  });
  const contas = companies.flatMap((c) => c.accounts.map((a) => ({ ...a, companyId: c.id })));
  const ids = contas.map((a) => a.id);

  const [coberturas, porMes, primeiras, ultimas, contasOfx] = await Promise.all([
    coberturaPorConta(ids),
    ids.length
      ? prisma.$queryRaw<Array<{ accountId: string; mes: string; total: number; sem_categoria: number; com_comprovante: number }>>`
          SELECT t."accountId", to_char(date_trunc('month', t."date"), 'YYYY-MM') AS mes, count(*)::int AS total,
                 count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM "TransactionSplit" s WHERE s."transactionId" = t."id" AND s."managerialCategoryId" IS NOT NULL
                 ))::int AS sem_categoria,
                 -- comprovante = anexo no lançamento OU a fatura Meta (PDF) casada pelo código
                 count(*) FILTER (WHERE t."hasReceipt" OR EXISTS (
                   SELECT 1 FROM "Document" d WHERE d."transactionId" = t."id"
                 ))::int AS com_comprovante
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
    // nº da conta no banco de quem recebe OFX (ofx:<banco>:<conta>:<chave>) — o que identifica a conta na tela
    ids.length
      ? prisma.$queryRaw<Array<{ accountId: string; conta: string }>>`
          SELECT DISTINCT ON (t."accountId") t."accountId", split_part(t."reference", ':', 3) AS conta
            FROM "Transaction" t WHERE t."accountId" = ANY(${ids}) AND t."reference" LIKE 'ofx:%'`
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
      const comComprovante = c?.com_comprovante ?? 0;
      const cob = coberturaDoMes(trechos, m);
      let imp: EstadoImp;
      if (cob.estado === "completo") imp = "completo";
      else if (cob.estado === "parcial") imp = "parcial";
      else if (total > 0) imp = "sem_comprovacao";
      else if (!primeiroDado || primeiroDado >= new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1))) imp = "antes";
      else imp = "faltando";
      meses[m] = {
        imp, total, semCategoria, comComprovante,
        ...(cob.estado === "parcial" ? { pedacos: cob.pedacos.map((p) => ({ de: p.de.toISOString(), ate: p.ate.toISOString() })) } : {}),
      };
    }
    const ult = ultimas.find((u) => u.accountId === a.id);
    return {
      id: a.id, name: a.name, bank: a.bank, currency: a.currency, companyId: a.companyId,
      configurada: !!a.syncConfig, // já tem a extração da API escolhida
      extracao: extracaoDe(a.syncConfig), // qual (id no banco); Revolut configurada com null = todas as contas
      contaBanco: contasOfx.find((o) => o.accountId === a.id)?.conta ?? null,
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
