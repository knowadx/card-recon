import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reconcile-bank-meta — explica POR QUE "Meta diz" ≠ "cobrado no banco".
 * Liga cada cobrança do banco à cobrança do Meta pelo elo do recibo
 * (bank.metaRef → MetaReceipt.referenceNumber → transactionId → MetaBillingCharge) e
 * decompõe a diferença em baldes. Tudo em US$, respeitando o piso do período.
 *   ?all=1 → ignora o piso
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ignoreFloor = new URL(request.url).searchParams.get("all") === "1";
  const floor = await getCheckFloor();
  const dateFilter = ignoreFloor ? {} : { gte: floor };

  const [bank, receipts, metaCharges, rateMap] = await Promise.all([
    prisma.transaction.findMany({
      where: { isMetaCharge: true, date: ignoreFloor ? undefined : { gte: floor } },
      select: { metaRef: true, amount: true, currency: true, billAmount: true, billCurrency: true, date: true, cardLast4: true, account: { select: { name: true, bank: true } } },
    }),
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true, transactionId: true } }),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: dateFilter }, select: { transactionId: true, amountUsd: true, chargedAt: true, accountName: true, accountId: true } }),
    loadRateMap(),
  ]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const bankUsdOf = (t: { billAmount: number | null; billCurrency: string | null; amount: number; currency: string; date: Date }) => {
    const m = t.date.toISOString().slice(0, 7);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    return toUsd(amt, cur, m, rateMap);
  };

  // elo: referenceNumber(lower) → cobrança Meta (só recibos cujo txId existe em MetaBillingCharge)
  const metaByTx = new Map(metaCharges.map((c) => [c.transactionId, c]));
  const metaByRef = new Map<string, typeof metaCharges[number]>();
  const allReceiptRefs = new Set<string>();
  for (const r of receipts) {
    const ref = r.referenceNumber!.toLowerCase();
    allReceiptRefs.add(ref);
    const mc = metaByTx.get(r.transactionId);
    if (mc) metaByRef.set(ref, mc);
  }

  const metaTotal = metaCharges.reduce((s, c) => s + c.amountUsd, 0);
  const bankTotal = bank.reduce((s, t) => s + bankUsdOf(t), 0);

  // baldes do lado BANCO
  const B = {
    casado: { qtde: 0, bankUsd: 0, metaUsd: 0, mesDiferente: 0 },
    bancoSemMetaControlada: { qtde: 0, usd: 0, amostra: [] as unknown[] }, // tem código+recibo, mas recibo NÃO é de cobrança Meta controlada → 🔴 candidato a vazamento
    codigoSemRecibo: { qtde: 0, usd: 0 },
    semCodigo: { qtde: 0, usd: 0 },
  };
  const matchedRefs = new Set<string>();

  for (const t of bank) {
    const usd = bankUsdOf(t);
    const ref = t.metaRef?.toLowerCase();
    if (!ref) { B.semCodigo.qtde++; B.semCodigo.usd += usd; continue; }
    const mc = metaByRef.get(ref);
    if (mc) {
      B.casado.qtde++; B.casado.bankUsd += usd; B.casado.metaUsd += mc.amountUsd;
      matchedRefs.add(ref);
      if (mc.chargedAt.toISOString().slice(0, 7) !== t.date.toISOString().slice(0, 7)) B.casado.mesDiferente++;
    } else if (allReceiptRefs.has(ref)) {
      B.bancoSemMetaControlada.qtde++; B.bancoSemMetaControlada.usd += usd;
      if (B.bancoSemMetaControlada.amostra.length < 15) B.bancoSemMetaControlada.amostra.push({ data: t.date.toISOString().slice(0, 10), usd: round2(usd), code: ref, card: t.cardLast4, conta: t.account?.name, bank: t.account?.bank });
    } else {
      B.codigoSemRecibo.qtde++; B.codigoSemRecibo.usd += usd;
    }
  }

  // lado META: cobranças controladas SEM débito no banco (recibo existe mas o código não aparece em nenhuma cobrança do banco)
  const refByTx = new Map(receipts.map((r) => [r.transactionId, r.referenceNumber!.toLowerCase()]));
  const metaSemBanco = { qtde: 0, usd: 0, semRecibo: 0, amostra: [] as unknown[] };
  for (const c of metaCharges) {
    const ref = refByTx.get(c.transactionId);
    if (!ref) { metaSemBanco.semRecibo++; continue; } // sem recibo não dá pra cruzar
    if (!matchedRefs.has(ref)) {
      metaSemBanco.qtde++; metaSemBanco.usd += c.amountUsd;
      if (metaSemBanco.amostra.length < 15) metaSemBanco.amostra.push({ data: c.chargedAt.toISOString().slice(0, 10), usd: c.amountUsd, conta: c.accountName, accountId: c.accountId });
    }
  }

  return NextResponse.json({
    piso: ignoreFloor ? "(todas as datas)" : floor.toISOString().slice(0, 10),
    metaTotalUsd: round2(metaTotal),
    bankTotalUsd: round2(bankTotal),
    diferencaUsd: round2(bankTotal - metaTotal),
    casado: { qtde: B.casado.qtde, bankUsd: round2(B.casado.bankUsd), metaUsd: round2(B.casado.metaUsd), deltaUsd_fxFee: round2(B.casado.bankUsd - B.casado.metaUsd), cobrancasEmMesDiferente: B.casado.mesDiferente },
    bancoSemMetaControlada_VAZAMENTO: { qtde: B.bancoSemMetaControlada.qtde, usd: round2(B.bancoSemMetaControlada.usd), amostra: B.bancoSemMetaControlada.amostra },
    bancoCodigoSemRecibo: { qtde: B.codigoSemRecibo.qtde, usd: round2(B.codigoSemRecibo.usd) },
    bancoSemCodigo: { qtde: B.semCodigo.qtde, usd: round2(B.semCodigo.usd) },
    metaControladaSemDebitoNoBanco: { qtde: metaSemBanco.qtde, usd: round2(metaSemBanco.usd), cobrancasMetaSemRecibo: metaSemBanco.semRecibo, amostra: metaSemBanco.amostra },
    legenda: {
      casado: "banco e Meta ligados pelo recibo. deltaUsd_fxFee = banco − Meta (taxa de câmbio/IOF da Revolut/Wise + arredondamento)",
      cobrancasEmMesDiferente: "cobranças casadas em que o mês do Meta ≠ mês do débito no banco (lag de vira-mês) → principal causa do mês não bater",
      bancoSemMetaControlada_VAZAMENTO: "banco debitou Meta, tem recibo, mas a conta NÃO é controlada por você 🔴",
      bancoSemCodigo: "débito Meta no banco sem metaRef (ex.: Revolut 1-3/mai não re-sincronizado)",
      metaControladaSemDebitoNoBanco: "Meta cobrou conta sua, mas não achei o débito num banco sincronizado (cartão fora dos extratos, ou débito em outro mês)",
    },
  });
}
