import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { accountScope, assertAccount, assertCompany, companyScope, guarded, requireUser, transactionScope } from "@/lib/access";
import { getSyncPeriod } from "@/lib/settings";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/**
 * GET /api/checagem — CHECK DE VAZAMENTO (modelo: extrato → código facebk → PDF).
 * Cada cobrança Meta no extrato (isMetaCharge) é classificada por hasReceipt/metaRef:
 *   ok          → tem código E PDF (hasReceipt=1) ✅
 *   codigoSemPdf→ tem código mas sem PDF 🔴
 *   semCodigo   → sem código facebk 🔴
 * O lado Meta entra só como DADO BRUTO (contas/cobranças/total), SEM correlação com o banco.
 */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  const account = params.get("account");
  // empresa/conta fora do escopo = 404 (não confirma que existe)
  if (company) await assertCompany(user, company);
  if (account) await assertAccount(user, account);
  const accountWhere = account
    ? { id: account }
    : company
      ? { companyId: company }
      : null;

  // JANELA DE ANÁLISE = início/fim do período (o "fim" limita só a VISÃO, não os syncs).
  const period = await getSyncPeriod();
  const floor = new Date(`${period.from}T00:00:00.000Z`);
  const ceiling = period.to ? new Date(`${period.to}T23:59:59.999Z`) : null;

  // filtro de mês (YYYY-MM) — sobrepõe a janela.
  const month = params.get("month");
  let dateRange: { gte: Date; lt?: Date; lte?: Date };
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const mStart = new Date(`${month}-01T00:00:00.000Z`);
    const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
    dateRange = { gte: mStart > floor ? mStart : floor, lt: mEnd };
  } else {
    dateRange = { gte: floor, ...(ceiling ? { lte: ceiling } : {}) };
  }

  // meses disponíveis (início → fim, ou hoje se sem fim) p/ o dropdown
  const mesesDisponiveis: string[] = [];
  for (let d = new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), 1)), end = ceiling ?? new Date();
       d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    mesesDisponiveis.push(d.toISOString().slice(0, 7));
  }
  mesesDisponiveis.reverse();

  // só as transações do grupo do usuário (superadmin = todas)
  const base = { isMetaCharge: true, date: dateRange, AND: [await transactionScope(user)], ...(accountWhere ? { account: accountWhere } : {}) };

  const [bank, companies, accounts, rateMap] = await Promise.all([
    prisma.transaction.findMany({
      where: base,
      select: { date: true, amount: true, currency: true, billAmount: true, billCurrency: true, metaRef: true, hasReceipt: true, cardLast4: true, account: { select: { bank: true } } },
    }),
    prisma.company.findMany({ where: await companyScope(user), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: await accountScope(user), select: { id: true, name: true, company: { select: { name: true } } }, orderBy: { name: "asc" } }),
    loadRateMap(),
  ]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  type Cell = { qtde: number; usd: number };
  const add = (c: Cell, usd: number) => { c.qtde++; c.usd += usd; };
  const novo = (): { ok: Cell; codigoSemPdf: Cell; semCodigo: Cell } => ({ ok: { qtde: 0, usd: 0 }, codigoSemPdf: { qtde: 0, usd: 0 }, semCodigo: { qtde: 0, usd: 0 } });

  const tot = novo();
  const porMesMap = new Map<string, ReturnType<typeof novo>>();
  const porCartaoMap = new Map<string, { bank: string | null; qtde: number; usd: number }>(); // 🔴 por cartão

  for (const t of bank) {
    const m = t.date.toISOString().slice(0, 7);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    const usd = toUsd(amt, cur, m, rateMap);
    const row = porMesMap.get(m) ?? novo();
    porMesMap.set(m, row);

    if (t.hasReceipt) {
      add(tot.ok, usd); add(row.ok, usd);
    } else {
      if (t.metaRef) { add(tot.codigoSemPdf, usd); add(row.codigoSemPdf, usd); }
      else { add(tot.semCodigo, usd); add(row.semCodigo, usd); }
      const card = t.cardLast4 ?? "(sem cartão)";
      const c = porCartaoMap.get(card) ?? { bank: t.account?.bank ?? null, qtde: 0, usd: 0 };
      c.qtde++; c.usd += usd; porCartaoMap.set(card, c);
    }
  }

  const fmtCell = (c: Cell) => ({ qtde: c.qtde, usd: round2(c.usd) });
  const fmtMes = (r: ReturnType<typeof novo>) => ({ ok: fmtCell(r.ok), codigoSemPdf: fmtCell(r.codigoSemPdf), semCodigo: fmtCell(r.semCodigo) });

  return NextResponse.json({
    piso: floor.toISOString().slice(0, 10),
    mesesDisponiveis,
    companies,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, company: a.company?.name ?? null })),
    // CHECK DE VAZAMENTO (extrato → código → PDF)
    vazamento: {
      total: fmtMes(tot),
      porMes: [...porMesMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([mes, r]) => ({ mes, ...fmtMes(r) })),
      porCartao: [...porCartaoMap.entries()].map(([cartao, v]) => ({ cartao, bank: v.bank, qtde: v.qtde, usd: round2(v.usd) })).sort((a, b) => b.usd - a.usd),
    },
  });
});
