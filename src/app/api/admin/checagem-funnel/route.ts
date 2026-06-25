import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/checagem-funnel — reproduz a lógica de "Qtde identif." da Checagem e mostra
 * ONDE cada cobrança do banco cai. "Identificada" exige 3 coisas:
 *   1) a cobrança do banco tem metaRef (código do extrato),
 *   2) esse metaRef = referenceNumber de um recibo (MetaReceipt),
 *   3) o transactionId desse recibo existe numa MetaBillingCharge.
 * Classifica cada cobrança e conta por categoria (total e por mês) → explica o 918/1091.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const floor = await getCheckFloor();
  const [bank, receipts, metaCharges] = await Promise.all([
    prisma.transaction.findMany({
      where: { isMetaCharge: true, date: { gte: floor } },
      select: { metaRef: true, date: true, reference: true, account: { select: { bank: true } } },
    }),
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true, transactionId: true } }),
    prisma.metaBillingCharge.findMany({ select: { transactionId: true } }),
  ]);

  const metaTxIds = new Set(metaCharges.map((c) => c.transactionId));
  // todos os referenceNumber de recibo (lower) e os que linkam a uma cobrança Meta
  const allReceiptRefs = new Set(receipts.map((r) => r.referenceNumber!.toLowerCase()));
  const refSet = new Set(receipts.filter((r) => metaTxIds.has(r.transactionId)).map((r) => r.referenceNumber!.toLowerCase()));

  type Cat = "identificada" | "recibo_sem_cobranca_meta" | "codigo_sem_recibo" | "sem_codigo";
  const cat = (metaRef: string | null): Cat => {
    if (!metaRef) return "sem_codigo";
    const m = metaRef.toLowerCase();
    if (refSet.has(m)) return "identificada";
    if (allReceiptRefs.has(m)) return "recibo_sem_cobranca_meta";
    return "codigo_sem_recibo";
  };

  const total: Record<Cat, number> = { identificada: 0, recibo_sem_cobranca_meta: 0, codigo_sem_recibo: 0, sem_codigo: 0 };
  const porMes: Record<string, Record<Cat, number>> = {};
  const porBanco: Record<string, Record<Cat, number>> = {};
  const amostraSemCodigo: { mes: string; bank: string | null; ref: string | null }[] = [];

  for (const t of bank) {
    const c = cat(t.metaRef);
    const mes = t.date.toISOString().slice(0, 7);
    const bankName = t.account?.bank ?? "?";
    total[c]++;
    (porMes[mes] ??= { identificada: 0, recibo_sem_cobranca_meta: 0, codigo_sem_recibo: 0, sem_codigo: 0 })[c]++;
    (porBanco[bankName] ??= { identificada: 0, recibo_sem_cobranca_meta: 0, codigo_sem_recibo: 0, sem_codigo: 0 })[c]++;
    if (c === "sem_codigo" && amostraSemCodigo.length < 10) amostraSemCodigo.push({ mes, bank: bankName, ref: t.reference });
  }

  return NextResponse.json({
    piso: floor.toISOString().slice(0, 10),
    totalCobrancasBanco: bank.length,
    recibos: receipts.length,
    cobrancasMeta_distinctTxId: metaTxIds.size,
    recibosQueLinkamCobrancaMeta: refSet.size,
    porCategoria: total,
    identificadas: `${total.identificada}/${bank.length}`,
    porMes,
    porBanco,
    amostraSemCodigo,
    legenda: {
      identificada: "tem código, casou com recibo, e o recibo tem cobrança Meta ✅",
      recibo_sem_cobranca_meta: "código casou com recibo, mas o transactionId do recibo NÃO está em MetaBillingCharge",
      codigo_sem_recibo: "tem código (metaRef) mas nenhum recibo com esse referenceNumber (faltam recibos desse mês?)",
      sem_codigo: "cobrança do banco sem metaRef (ex.: Revolut 1-3/mai não re-sincronizado, ou sem código)",
    },
  });
}
