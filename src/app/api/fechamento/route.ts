import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { accessibleOperationsWhere, isSuperadmin, scopes } from "@/lib/auth";
import { accountScope, assertCompany, companyScope, guarded, requireUser, transactionScope } from "@/lib/access";
import { metaTokenStatus } from "@/lib/meta";

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
    where: { isMetaCharge: true, AND: [await transactionScope(user)] },
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

  const [contas, metaConexoes, pendentes] = await Promise.all([
    contasDoPasso1(user, companyParam, dateRange),
    conexoesMeta(user),
    semFaturaDoMes({ ...bankBase, hasReceipt: false }),
  ]);

  return NextResponse.json({
    mesesDisponiveis: meses,
    contas,
    metaConexoes,
    pendentes,
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
const SINCRONIZAVEIS = ["Mercury", "Wise", "Revolut"];
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Passo 1: cada conta do escopo — já configurada pro sync? tem chave? até quando tem dados? */
async function contasDoPasso1(user: AppUserLike, companyId: string, dateRange: { gte: Date; lt: Date }) {
  const contas = await prisma.account.findMany({
    where: { AND: [await accountScope(user), ...(companyId ? [{ companyId }] : [])] },
    select: { id: true, name: true, bank: true, currency: true, syncConfig: true, apiToken: true, company: { select: { id: true, name: true } } },
    orderBy: [{ bank: "asc" }, { name: "asc" }],
  });
  const ids = contas.map((c) => c.id);
  const [ultimas, metaNoMes, creds] = await Promise.all([
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _max: { date: true } }),
    prisma.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: ids }, isMetaCharge: true, date: dateRange }, _count: { _all: true } }),
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
    cobrancasMetaNoMes: metaNoMes.find((m) => m.accountId === c.id)?._count._all ?? 0,
  }));
}

/** Passo 3: conexão Meta de cada operação do escopo — existe? ainda vale (pergunta à Meta)? */
async function conexoesMeta(user: AppUserLike) {
  const escopo = await accessibleOperationsWhere(user);
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
async function semFaturaDoMes(where: Prisma.TransactionWhereInput) {
  const LIMITE = 500;
  const [lista, total, semCodigo] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: {
        id: true, date: true, description: true, amount: true, currency: true, billAmount: true, billCurrency: true,
        metaRef: true, cardLast4: true, cardLabel: true, account: { select: { name: true, bank: true, company: { select: { name: true } } } },
      },
      orderBy: { date: "desc" },
      take: LIMITE,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.count({ where: { AND: [where, { metaRef: null }] } }),
  ]);
  return {
    total,
    semCodigo, // a Revolut não manda o código pela API → sobe o CSV do mês (passo 2)
    codigoSemPdf: total - semCodigo, // tem código mas o PDF não está aqui → importe as faturas (passo 4)
    limite: LIMITE,
    lista: lista.map((t) => ({
      id: t.id,
      data: dia(t.date),
      banco: t.account.bank,
      conta: t.account.name,
      empresa: t.account.company.name,
      cartao: t.cardLast4 ? `${t.cardLabel ? `${t.cardLabel} ` : ""}··${t.cardLast4}` : null,
      descricao: t.description,
      valor: t.billAmount ?? Math.abs(t.amount),
      moeda: t.billAmount != null ? (t.billCurrency ?? t.currency) : t.currency,
      codigo: t.metaRef,
    })),
  };
}
