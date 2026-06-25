import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/leak-check — A CHECAGEM DE VAZAMENTO (modelo do usuário).
 * Para CADA transação do extrato classificada como Meta/Facebook (isMetaCharge):
 *   ok          → tem código facebk (metaRef) E o código tem PDF salvo (MetaReceipt) ✅
 *   codigoSemPdf→ tem código mas NÃO há PDF → conta Meta de origem fora do seu controle 🔴
 *   semCodigo   → cobrança Meta SEM código facebk → risco certo de vazamento 🔴
 * NÃO usa MetaBillingCharge (isso é só "a grosso modo"). Chave = código ↔ PDF.
 *   ?month=2026-05  (default: todos >= piso; quebra por mês sempre)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const month = new URL(request.url).searchParams.get("month");
  const floor = await getCheckFloor();

  const [bank, receipts, rateMap] = await Promise.all([
    prisma.transaction.findMany({
      where: { isMetaCharge: true, date: { gte: floor } },
      select: { metaRef: true, amount: true, currency: true, billAmount: true, billCurrency: true, date: true, cardLast4: true, account: { select: { name: true, bank: true } } },
    }),
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true } }),
    loadRateMap(),
  ]);
  const pdfCodes = new Set(receipts.map((r) => r.referenceNumber!.toLowerCase())); // códigos com PDF salvo
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const usdOf = (t: { billAmount: number | null; billCurrency: string | null; amount: number; currency: string; date: Date }) => {
    const m = t.date.toISOString().slice(0, 7);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    return toUsd(amt, cur, m, rateMap);
  };

  type Bucket = { qtde: number; usd: number };
  type MonthRow = { ok: Bucket; codigoSemPdf: Bucket; semCodigo: Bucket };
  const novoMes = (): MonthRow => ({ ok: { qtde: 0, usd: 0 }, codigoSemPdf: { qtde: 0, usd: 0 }, semCodigo: { qtde: 0, usd: 0 } });
  const porMes = new Map<string, MonthRow>();
  // detalhe dos 🔴 por cartão (só do mês filtrado, se houver)
  const semCodigoPorCartao = new Map<string, { qtde: number; usd: number; bank: string | null }>();
  const codigoSemPdfPorCartao = new Map<string, { qtde: number; usd: number; bank: string | null }>();

  for (const t of bank) {
    const mes = t.date.toISOString().slice(0, 7);
    if (month && mes !== month) continue;
    const usd = usdOf(t);
    const row = porMes.get(mes) ?? novoMes();
    porMes.set(mes, row);
    const card = t.cardLast4 ?? "(sem cartão)";

    if (!t.metaRef) {
      row.semCodigo.qtde++; row.semCodigo.usd += usd;
      const r = semCodigoPorCartao.get(card) ?? { qtde: 0, usd: 0, bank: t.account?.bank ?? null };
      r.qtde++; r.usd += usd; semCodigoPorCartao.set(card, r);
    } else if (pdfCodes.has(t.metaRef.toLowerCase())) {
      row.ok.qtde++; row.ok.usd += usd;
    } else {
      row.codigoSemPdf.qtde++; row.codigoSemPdf.usd += usd;
      const r = codigoSemPdfPorCartao.get(card) ?? { qtde: 0, usd: 0, bank: t.account?.bank ?? null };
      r.qtde++; r.usd += usd; codigoSemPdfPorCartao.set(card, r);
    }
  }

  const fmtCard = (m: Map<string, { qtde: number; usd: number; bank: string | null }>) =>
    [...m.entries()].map(([cartao, v]) => ({ cartao, bank: v.bank, qtde: v.qtde, usd: round2(v.usd) })).sort((a, b) => b.usd - a.usd);
  const fmtMes = (r: MonthRow) => ({
    ok: { qtde: r.ok.qtde, usd: round2(r.ok.usd) },
    codigoSemPdf_🔴: { qtde: r.codigoSemPdf.qtde, usd: round2(r.codigoSemPdf.usd) },
    semCodigo_🔴: { qtde: r.semCodigo.qtde, usd: round2(r.semCodigo.usd) },
  });

  return NextResponse.json({
    piso: floor.toISOString().slice(0, 10),
    filtroMes: month ?? "(todos >= piso)",
    porMes: Object.fromEntries([...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, r]) => [m, fmtMes(r)])),
    leak_semCodigo_porCartao: fmtCard(semCodigoPorCartao),
    leak_codigoSemPdf_porCartao: fmtCard(codigoSemPdfPorCartao),
    legenda: {
      ok: "extrato Meta com código facebk E PDF salvo → conta de origem sob seu controle ✅",
      "codigoSemPdf_🔴": "tem código mas nenhum PDF salvo → conta Meta de origem fora do seu controle (ou PDF do mês ainda não salvo)",
      "semCodigo_🔴": "cobrança Meta no extrato SEM código facebk → risco certo de vazamento (ou Revolut sem CSV importado)",
    },
  });
}
