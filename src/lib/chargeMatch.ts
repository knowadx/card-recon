import { prisma } from "./db";
import { META_RE } from "./metaCheck";

/**
 * Matching extrato × cobranças reais do Meta (MetaBillingCharge), por MOEDA + VALOR + DATA.
 * NÃO-exclusivo: uma cobrança do extrato é "ok" se EXISTE pelo menos uma cobrança Meta de uma
 * conta sua com mesma moeda, valor (±1) e data (±3 dias). Isso bate com a intuição "mesma data e
 * valor = verde" e evita falsos 🔴 do consumo 1:1 (valores comuns como US$1.950 colidiam).
 *
 *   - ok     → existe cobrança Meta correspondente (atribui a conta/BM)
 *   - leak   → SEM correspondente e o valor é confiável em USD (billAmount, ou conta USD) → suspeito
 *   - review → SEM correspondente mas sem valor USD confiável (ex.: cobrança em EUR sem billAmount)
 *              → re-sincronizar o banco p/ capturar o billAmount (USD original) e poder casar
 */
export async function runChargeMatch(): Promise<{ metaTx: number; ok: number; leak: number; review: number }> {
  const [metaCharges, txs] = await Promise.all([
    prisma.metaBillingCharge.findMany({ select: { amountUsd: true, currency: true, chargedAt: true, accountName: true, bmName: true } }),
    prisma.transaction.findMany({
      select: { id: true, date: true, description: true, isMetaCharge: true, amount: true, currency: true, billAmount: true, billCurrency: true, metaCheck: true },
    }),
  ]);

  // buckets por "MOEDA|valor inteiro" → lista de cobranças Meta (sem consumir)
  const buckets = new Map<string, { amount: number; currency: string; chargedAt: number; note: string }[]>();
  const keyOf = (cur: string, v: number) => `${cur}|${Math.round(v)}`;
  for (const m of metaCharges) {
    const note = `Conta ${m.accountName ?? "?"}${m.bmName ? ` · BM ${m.bmName}` : ""}`;
    const k = keyOf(m.currency, m.amountUsd);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push({ amount: m.amountUsd, currency: m.currency, chargedAt: m.chargedAt.getTime(), note });
  }

  const okByNote = new Map<string, string[]>();
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = [];

  for (const t of txs) {
    if (!(t.isMetaCharge || META_RE.test(t.description))) {
      if (t.metaCheck) clearIds.push(t.id);
      continue;
    }
    // moeda+valor p/ casar: billAmount (moeda original da Meta) tem prioridade; senão o da transação
    const usable = t.billAmount != null;
    const amt = usable ? t.billAmount! : Math.abs(t.amount);
    const cur = (usable ? t.billCurrency : t.currency) || t.currency;
    const tt = t.date.getTime();

    let note: string | null = null;
    let bestDelta = Infinity;
    for (const k of [keyOf(cur, amt), keyOf(cur, amt - 1), keyOf(cur, amt + 1)]) {
      const arr = buckets.get(k);
      if (!arr) continue;
      for (const e of arr) {
        if (e.currency !== cur || Math.abs(e.amount - amt) > 1.0) continue;
        const dd = Math.abs(e.chargedAt - tt);
        if (dd <= 3 * 86400000 && dd < bestDelta) { bestDelta = dd; note = e.note; }
      }
    }

    if (note) { const a = okByNote.get(note) ?? []; a.push(t.id); okByNote.set(note, a); }
    else if (usable || cur === "USD") leakIds.push(t.id); // valor confiável e sem par → suspeito
    else reviewIds.push(t.id); // sem billAmount e moeda ≠ USD → não dá p/ casar com certeza
  }

  const applyMany = async (ids: string[], data: Record<string, unknown>) => {
    for (let i = 0; i < ids.length; i += 200) await prisma.transaction.updateMany({ where: { id: { in: ids.slice(i, i + 200) } }, data });
  };
  let okCount = 0;
  for (const [note, ids] of okByNote) { await applyMany(ids, { metaCheck: "ok", metaCheckNote: note }); okCount += ids.length; }
  await applyMany(leakIds, { metaCheck: "leak", metaCheckNote: null });
  await applyMany(reviewIds, { metaCheck: "review", metaCheckNote: null });
  await applyMany(clearIds, { metaCheck: null, metaCheckNote: null });

  return { metaTx: okCount + leakIds.length + reviewIds.length, ok: okCount, leak: leakIds.length, review: reviewIds.length };
}
