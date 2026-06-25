import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reconcile-receipts — atribui cada cobrança do extrato (metaRef) à conta de
 * anúncio real via MetaReceipt, SÓ por CÓDIGO (metaRef ↔ referenceNumber). Sem valor+data.
 *   ok            → recibo encontrado e a conta é controlada (MetaAdAccount)
 *   nao_controlada → recibo aponta p/ conta que você NÃO controla (vazamento suspeito)
 *   sem_recibo    → metaRef sem recibo correspondente (ou cobrança sem código, ex.: Revolut)
 * Só leitura. Exige login.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [receipts, controlledAccts, bank] = await Promise.all([
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { referenceNumber: true, accountId: true, accountName: true } }),
    prisma.metaAdAccount.findMany({ select: { accountId: true } }),
    prisma.transaction.findMany({ where: { metaRef: { not: null } }, select: { metaRef: true, amount: true, date: true, cardLast4: true } }),
  ]);

  const refMap = new Map(receipts.map((r) => [r.referenceNumber!.toLowerCase(), r]));
  const controlled = new Set(controlledAccts.map((a) => a.accountId));

  const buckets = { ok: 0, nao_controlada: 0, sem_recibo: 0 };
  const okByAccount = new Map<string, { name: string | null; count: number }>();
  const leak: { metaRef: string; account: string | null; accountId: string | null; amount: number; date: string; card: string | null }[] = [];
  const semReciboSample: { metaRef: string; amount: number; date: string; card: string | null }[] = [];

  for (const t of bank) {
    const rec = refMap.get(t.metaRef!.toLowerCase());
    if (!rec) {
      buckets.sem_recibo++;
      if (semReciboSample.length < 50) semReciboSample.push({ metaRef: t.metaRef!, amount: t.amount, date: t.date.toISOString().slice(0, 10), card: t.cardLast4 });
    } else if (rec.accountId && controlled.has(rec.accountId)) {
      buckets.ok++;
      const row = okByAccount.get(rec.accountId) ?? { name: rec.accountName, count: 0 };
      row.count++; okByAccount.set(rec.accountId, row);
    } else {
      buckets.nao_controlada++;
      if (leak.length < 200) leak.push({ metaRef: t.metaRef!, account: rec.accountName, accountId: rec.accountId, amount: t.amount, date: t.date.toISOString().slice(0, 10), card: t.cardLast4 });
    }
  }

  return NextResponse.json({
    cobrancasComMetaRef: bank.length,
    recibosNoBanco: receipts.length,
    contasControladas: controlled.size,
    resultado: buckets,
    cobertura: bank.length ? `${Math.round(((buckets.ok + buckets.nao_controlada) / bank.length) * 100)}% com recibo` : "—",
    contasOk: [...okByAccount.entries()].map(([accountId, v]) => ({ accountId, ...v })).sort((a, b) => b.count - a.count),
    vazamentoSuspeito: leak,
    semReciboAmostra: semReciboSample,
  });
}
