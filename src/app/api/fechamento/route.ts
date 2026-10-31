import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { memberOperationsWhere, isSuperadmin, scopes } from "@/lib/auth";
import { accountScope, assertCompany, companyScope, guarded, requireUser, transactionScope } from "@/lib/access";
import { metaTokenStatus } from "@/lib/meta";
import { SINCRONIZAVEIS, statusDoMes } from "@/lib/importStatus";
import { COBRANCA_DO_FECHAMENTO, cobrancasDoMes, ondeCobrancasDoMes, resumoPorCartao, totaisDoMes } from "@/lib/cobrancasMeta";

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

  // Meses do seletor: do 1º mês com cobrança Meta (no escopo do usuário) até o mês atual. NÃO depende
  // do "período de análise" da Checagem — escolhe-se o mês aqui mesmo (pedido do dono em 2026-10-16;
  // antes, com o período em 01/06–30/06, só junho aparecia).
  const primeira = await prisma.transaction.findFirst({
    where: { ...COBRANCA_DO_FECHAMENTO, AND: [await transactionScope(user)] },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const agora = new Date();
  const inicio = primeira?.date ?? agora;
  const meses: string[] = [];
  for (let d = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)); d <= agora; d.setUTCMonth(d.getUTCMonth() + 1)) meses.push(d.toISOString().slice(0, 7));
  meses.reverse();

  // empresas que o usuário enxerga (pra o seletor de escopo)
  const companies = await prisma.company.findMany({ where: await companyScope(user), select: { id: true, name: true }, orderBy: { name: "asc" } });

  // cada mês: liberado só com a importação terminada (src/lib/importStatus.ts — regra única)
  const contasDoEscopo = await prisma.account.findMany({
    where: { AND: [await accountScope(user), ...(companyParam ? [{ companyId: companyParam }] : [])] },
    select: { name: true, bank: true, syncConfig: true, syncedThrough: true },
  });
  const paraStatus = contasDoEscopo.map((c) => ({ nome: c.name, banco: c.bank, configurada: !!c.syncConfig, syncedThrough: c.syncedThrough }));
  const mesesStatus = Object.fromEntries(meses.map((m) => [m, statusDoMes(m, paraStatus, agora)]));

  // sem mês pedido: o mais recente LIBERADO (o mês corrente nunca está)
  const pedido = params.get("month") && /^\d{4}-\d{2}$/.test(params.get("month")!) ? params.get("month")! : null;
  const month = pedido ?? meses.find((m) => mesesStatus[m].liberado) ?? meses[0];
  if (!month) return NextResponse.json({ mesesDisponiveis: meses, mesesStatus, companies, month: null });
  const status = mesesStatus[month] ?? statusDoMes(month, paraStatus, agora);
  if (!status.liberado) {
    // mês com a importação incompleta: não dá pra conferir — devolve só o motivo (e o passo 1, pra ver o que falta)
    const mStartB = new Date(`${month}-01T00:00:00.000Z`);
    const mEndB = new Date(mStartB); mEndB.setUTCMonth(mEndB.getUTCMonth() + 1);
    return NextResponse.json({
      mesesDisponiveis: meses, mesesStatus, companies, company: companyParam || null, month,
      bloqueado: status.motivo,
      contas: await contasDoPasso1(user, companyParam, { gte: mStartB, lt: mEndB }),
    });
  }

  const mStart = new Date(`${month}-01T00:00:00.000Z`);
  const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
  const dateRange = { gte: mStart, lt: mEnd };

  // escopo: 1 empresa selecionada (já conferida acima) e, sempre, só as transações do grupo do usuário.
  // TODOS os números do extrato saem da MESMA lista (src/lib/cobrancasMeta.ts): topo, passos e resumo por cartão.
  const bankBase = await ondeCobrancasDoMes(user, month, companyParam);
  // cobranças Meta: por operação (como antes) — superadmin vê todas; os demais, só as das operações em que são membros
  const metaScope = isSuperadmin(user.role) ? {} : { operationId: { in: (await scopes(user.id)).operationIds } };

  const [cobrancas, metaCobrancas, contas, metaConexoes, importacoes] = await Promise.all([
    cobrancasDoMes(bankBase),
    prisma.metaBillingCharge.count({ where: { chargedAt: dateRange, ...metaScope } }),
    contasDoPasso1(user, companyParam, dateRange),
    conexoesMeta(user),
    importacoesDoMes(user, dateRange),
  ]);
  const totais = totaisDoMes(cobrancas); // checado × pendente em quantidade e valor (por moeda)
  const bancoMeta = totais.total.qtd;
  const comFatura = totais.checado.qtd;
  const semFatura = totais.pendente.qtd;
  const revolutSemCodigo = cobrancas.filter((c) => c.situacao === "sem_codigo" && c.banco === "Revolut").length;
  // sem código: a Revolut não manda o código pela API → sobe o CSV do mês (passo 2);
  // com código e sem PDF: importe as faturas (passo das faturas)
  const pendentes = { total: semFatura, semCodigo: totais.semCodigo.qtd, codigoSemPdf: totais.semPdf.qtd };

  return NextResponse.json({
    mesesDisponiveis: meses,
    mesesStatus,
    contas,
    metaConexoes,
    pendentes,
    totais,
    cartoes: resumoPorCartao(cobrancas),
    importacoes,
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

type AppUserLike = Awaited<ReturnType<typeof requireUser>>;
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Passo 1: cada conta do escopo — já configurada pro sync? tem chave? até quando tem dados? */
async function contasDoPasso1(user: AppUserLike, companyId: string, dateRange: { gte: Date; lt: Date }) {
  const contas = await prisma.account.findMany({
    where: { AND: [await accountScope(user), ...(companyId ? [{ companyId }] : [])] },
    select: { id: true, name: true, bank: true, currency: true, syncConfig: true, syncedThrough: true, apiToken: true, company: { select: { id: true, name: true } } },
    orderBy: [{ bank: "asc" }, { name: "asc" }],
  });
  const ids = contas.map((c) => c.id);
  const [ultimas, metaNoMes, semCodigo, creds] = await Promise.all([
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _max: { date: true } }),
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids }, ...COBRANCA_DO_FECHAMENTO, date: dateRange }, _count: { _all: true } }),
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids }, ...COBRANCA_DO_FECHAMENTO, metaRef: null, date: dateRange }, _count: { _all: true } }),
    prisma.credential.findMany({
      where: { company: { in: [...new Set(contas.map((c) => c.company.name))] }, isActive: true, NOT: { token: "" } },
      select: { issuer: true, company: true },
    }),
  ]);
  const temCred = (issuer: string, company: string) => creds.some((c) => c.issuer === issuer && c.company === company);
  return contas.map((c) => ({
    id: c.id,
    nome: c.name,
    banco: c.bank,
    empresa: c.company.name,
    moeda: c.currency,
    manual: !SINCRONIZAVEIS.includes(c.bank), // ex.: Husky = planilha
    configurada: !!c.syncConfig, // já sincronizou uma vez (o "Sincronizar todas" só pega estas)
    temChave: c.bank === "Revolut" ? temCred("revolut", c.company.name) : !!c.apiToken || temCred(c.bank.toLowerCase(), c.company.name),
    ultimaTransacao: dia(ultimas.find((u) => u.accountId === c.id)?._max.date),
    sincronizadaAte: dia(c.syncedThrough), // fim do último sync completo — o que libera o mês
    cobrancasMetaNoMes: metaNoMes.find((m) => m.accountId === c.id)?._count._all ?? 0,
    semCodigoNoMes: semCodigo.find((m) => m.accountId === c.id)?._count._all ?? 0, // passo 2: CSV de qual conta falta
  }));
}

/** Passo 3: conexão Meta de cada operação que o usuário opera — existe? ainda vale (pergunta à Meta)? */
async function conexoesMeta(user: AppUserLike) {
  const escopo = await memberOperationsWhere(user);
  const ops = await prisma.operation.findMany({ where: escopo ?? {}, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const creds = await prisma.credential.findMany({
    where: { issuer: "meta", isActive: true, operationId: { in: ops.map((o) => o.id) } },
    select: { operationId: true, token: true },
  });
  return Promise.all(
    ops.map(async (o) => {
      const cred = creds.find((c) => c.operationId === o.id);
      if (!cred) return { operationId: o.id, operacao: o.name, conectado: false, valido: null, expiraEm: null, erro: null };
      return { operationId: o.id, operacao: o.name, conectado: true, ...(await metaTokenStatus(cred.token)) };
    }),
  );
}

/** Resultado: as cobranças Meta do mês ainda SEM fatura — com o motivo (sem código × código sem PDF). */
/** Histórico do mês: importações (CSV Revolut, faturas PDF) cujo conteúdo cobre o mês. Escopo: empresas visíveis. */
async function importacoesDoMes(user: AppUserLike, dateRange: { gte: Date; lt: Date }) {
  const ultimoDia = new Date(dateRange.lt.getTime() - 1);
  const visiveis = isSuperadmin(user.role)
    ? null
    : (await prisma.company.findMany({ where: await companyScope(user), select: { id: true } })).map((c) => c.id);
  const logs = await prisma.importLog.findMany({
    where: {
      AND: [
        { OR: [{ periodFrom: null }, { periodFrom: { lte: ultimoDia } }] },
        { OR: [{ periodTo: null }, { periodTo: { gte: dateRange.gte } }] },
        ...(visiveis ? [{ OR: [{ companyIds: { isEmpty: true } }, { companyIds: { hasSome: visiveis } }] }] : []),
      ],
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return logs.map((l) => ({
    id: l.id,
    tipo: l.kind,
    arquivo: l.filename,
    quem: l.user?.name || l.user?.email || "—",
    quando: l.createdAt.toISOString(),
    de: dia(l.periodFrom),
    ate: dia(l.periodTo),
    resumo: JSON.parse(l.summary) as Record<string, unknown>,
  }));
}
