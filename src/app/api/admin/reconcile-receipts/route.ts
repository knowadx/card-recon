import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DAY = 86400000;
const WINDOW = 3 * DAY; // ±3 dias entre data do recibo e da cobrança no extrato

/**
 * GET /api/admin/reconcile-receipts — atribui cada cobrança Meta do extrato à conta real.
 * 2 passadas: (1) por CÓDIGO (metaRef ↔ referenceNumber) — Wise; (2) por CARTÃO + valor US$ +
 * data — Revolut (que não traz o código), exclusivo. Classifica ok / conta não controlada /
 * sem recibo. Só leitura.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [receipts, controlledAccts, bank] = await Promise.all([
    prisma.metaReceipt.findMany({ select: { referenceNumber: true, accountId: true, accountName: true, cardLast4: true, amountUsd: true, date: true } }),
    prisma.metaAdAccount.findMany({ select: { accountId: true } }),
    prisma.transaction.findMany({ where: { isMetaCharge: true }, select: { metaRef: true, amount: true, currency: true, billAmount: true, date: true, cardLast4: true } }),
  ]);

  const controlled = new Set(controlledAccts.map((a) => a.accountId));
  const refMap = new Map(receipts.filter((r) => r.referenceNumber).map((r) => [r.referenceNumber!.toLowerCase(), r]));

  // índice p/ a 2ª passada: (cartão | centavos US$) -> entradas consumíveis 1x
  type Entry = { dateMs: number; accountId: string | null; accountName: string | null; ref: string | null; used: boolean };
  const cardAmt = new Map<string, Entry[]>();
  for (const r of receipts) {
    if (!r.cardLast4 || r.amountUsd == null) continue;
    const key = `${r.cardLast4}|${Math.round(r.amountUsd * 100)}`;
    if (!cardAmt.has(key)) cardAmt.set(key, []);
    cardAmt.get(key)!.push({ dateMs: r.date ? r.date.getTime() : 0, accountId: r.accountId, accountName: r.accountName, ref: r.referenceNumber, used: false });
  }
  const usedRefs = new Set<string>(); // recibos já consumidos pela passada de código

  const buckets = { ok: 0, nao_controlada: 0, sem_recibo: 0 };
  const via = { codigo: 0, valor: 0 };
  const okByAccount = new Map<string, { name: string | null; count: number }>();
  const leak: { account: string | null; accountId: string | null; usd: number; date: string; card: string | null; via: string }[] = [];
  const semRecibo: { metaRef: string | null; usd: number; date: string; card: string | null }[] = [];

  const classify = (acctId: string | null, acctName: string | null, t: { date: Date; cardLast4: string | null }, usd: number, source: string) => {
    if (acctId && controlled.has(acctId)) {
      buckets.ok++;
      const row = okByAccount.get(acctId) ?? { name: acctName, count: 0 };
      row.count++; okByAccount.set(acctId, row);
    } else {
      buckets.nao_controlada++;
      if (leak.length < 200) leak.push({ account: acctName, accountId: acctId, usd, date: t.date.toISOString().slice(0, 10), card: t.cardLast4, via: source });
    }
  };

  for (const t of bank) {
    const usd = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    // 1) por código (Wise)
    const byCode = t.metaRef ? refMap.get(t.metaRef.toLowerCase()) : undefined;
    if (byCode) {
      via.codigo++;
      if (byCode.referenceNumber) usedRefs.add(byCode.referenceNumber.toLowerCase());
      classify(byCode.accountId, byCode.accountName, t, usd, "codigo");
      continue;
    }
    // 2) por cartão + valor US$ + data (Revolut)
    const arr = t.cardLast4 ? cardAmt.get(`${t.cardLast4}|${Math.round(usd * 100)}`) : undefined;
    let best: Entry | null = null, bestD = Infinity;
    if (arr) for (const e of arr) {
      if (e.used || (e.ref && usedRefs.has(e.ref.toLowerCase()))) continue;
      const d = Math.abs(e.dateMs - t.date.getTime());
      if (d <= WINDOW && d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      best.used = true; via.valor++;
      classify(best.accountId, best.accountName, t, usd, "valor+data");
      continue;
    }
    buckets.sem_recibo++;
    if (semRecibo.length < 50) semRecibo.push({ metaRef: t.metaRef, usd, date: t.date.toISOString().slice(0, 10), card: t.cardLast4 });
  }

  const total = bank.length;
  return NextResponse.json({
    cobrancasMeta: total,
    recibos: receipts.length,
    contasControladas: controlled.size,
    resultado: buckets,
    matchVia: via, // quantas casaram por código (Wise) vs por valor+data (Revolut)
    cobertura: total ? `${Math.round(((buckets.ok + buckets.nao_controlada) / total) * 100)}%` : "—",
    contasOk: [...okByAccount.entries()].map(([accountId, v]) => ({ accountId, ...v })).sort((a, b) => b.count - a.count).slice(0, 60),
    vazamentoSuspeito: leak,
    semReciboAmostra: semRecibo,
  });
}
