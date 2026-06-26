import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";
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
export async function GET(request: Request) {
  const scope = await scopedCompanyIds();
  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  const account = params.get("account");
  const accountWhere = account
    ? { id: account }
    : company
      ? { companyId: company }
      : scope === "all"
        ? null
        : { companyId: { in: scope } };

  const floor = await getCheckFloor();

  // filtro de mês (YYYY-MM). gte = max(floor, início do mês); lt = início do mês seguinte.
  const month = params.get("month");
  let dateRange: { gte: Date; lt?: Date } = { gte: floor };
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const mStart = new Date(`${month}-01T00:00:00.000Z`);
    const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
    dateRange = { gte: mStart > floor ? mStart : floor, lt: mEnd };
  }

  // meses disponíveis (do piso até hoje) p/ o dropdown
  const mesesDisponiveis: string[] = [];
  for (let d = new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), 1)), now = new Date();
       d <= now; d.setUTCMonth(d.getUTCMonth() + 1)) {
    mesesDisponiveis.push(d.toISOString().slice(0, 7));
  }
  mesesDisponiveis.reverse();

  const base = { isMetaCharge: true, date: dateRange, ...(accountWhere ? { account: accountWhere } : {}) };

  const [bank, metaContas, metaCharges, companies, accounts, rateMap] = await Promise.all([
    prisma.transaction.findMany({
      where: base,
      select: { date: true, amount: true, currency: true, billAmount: true, billCurrency: true, metaRef: true, hasReceipt: true, cardLast4: true, account: { select: { bank: true } } },
    }),
    prisma.metaAdAccount.count(),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: dateRange }, select: { amountUsd: true, currency: true, chargedAt: true } }),
    prisma.company.findMany({ where: scope === "all" ? {} : { id: { in: scope } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: scope === "all" ? {} : { companyId: { in: scope } }, select: { id: true, name: true, company: { select: { name: true } } }, orderBy: { name: "asc" } }),
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

  const metaTotalUsd = metaCharges.reduce((s, c) => s + toUsd(c.amountUsd, c.currency, c.chargedAt.toISOString().slice(0, 7), rateMap), 0);

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
    // META — só dado bruto, sem correlação
    meta: { contas: metaContas, cobrancas: metaCharges.length, totalUsd: round2(metaTotalUsd) },
  });
}
