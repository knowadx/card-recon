import { prisma } from "./db";
import { META_RE } from "./metaCheck";

/**
 * Matching extrato × cobranças reais do Meta (MetaBillingCharge).
 * Casa cada cobrança Meta do banco com uma cobrança real de uma conta sua, por
 * **MOEDA + VALOR + DATA** (±3 dias, tolerância de 1 unidade da moeda). Funciona em
 * qualquer moeda (USD, EUR, BRL…) — a cobrança do Meta e a do banco vêm na MESMA moeda
 * (a da conta de anúncio). Coração do antifraude:
 *   - ok     → bateu com cobrança de uma conta/BM sua (atribuída, com nome)
 *   - leak   → cobrança no cartão SEM par em nenhuma conta sua
 *   - review → cobrança sem valor utilizável (não deve ocorrer)
 *
 * Valor do extrato usado p/ casar: bill_amount/bill_currency (moeda original que a Meta
 * cobrou) quando existe; senão o amount/currency da própria transação.
 */
export async function runChargeMatch(): Promise<{ metaTx: number; ok: number; leak: number; review: number; metaUnmatched: number }> {
  const [metaCharges, txs] = await Promise.all([
    prisma.metaBillingCharge.findMany({ select: { amountUsd: true, currency: true, chargedAt: true, accountName: true, bmName: true } }),
    prisma.transaction.findMany({
      select: { id: true, date: true, description: true, isMetaCharge: true, amount: true, currency: true, billAmount: true, billCurrency: true, metaCheck: true },
    }),
  ]);

  // buckets por "MOEDA|valor inteiro"; cada cobrança Meta usada 1x.
  // nota = Conta · BM (agrupável → updateMany em lote; o valor/data o usuário vê na própria linha)
  const buckets = new Map<string, { used: boolean; amount: number; currency: string; chargedAt: Date; note: string }[]>();
  const keyOf = (cur: string, v: number) => `${cur}|${Math.round(v)}`;
  for (const m of metaCharges) {
    const note = `Conta ${m.accountName ?? "?"}${m.bmName ? ` · BM ${m.bmName}` : ""}`;
    const k = keyOf(m.currency, m.amountUsd);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push({ used: false, amount: m.amountUsd, currency: m.currency, chargedAt: m.chargedAt, note });
  }

  const okByNote = new Map<string, string[]>(); // nota → ids (agrupado p/ updateMany)
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = [];
  let usedMeta = 0;

  const bank = txs.filter((t) => t.isMetaCharge || META_RE.test(t.description)).sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const t of bank) {
    // moeda+valor da cobrança: bill_amount (moeda original da Meta) tem prioridade; senão o da transação
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    if (amt == null || !cur) { reviewIds.push(t.id); continue; }

    let match: { used: boolean; note: string } | null = null;
    let bestDelta = Infinity;
    for (const k of [keyOf(cur, amt), keyOf(cur, amt - 1), keyOf(cur, amt + 1)]) {
      const arr = buckets.get(k);
      if (!arr) continue;
      for (const e of arr) {
        if (e.used || e.currency !== cur || Math.abs(e.amount - amt) > 1.0) continue;
        const dd = Math.abs(e.chargedAt.getTime() - t.date.getTime());
        if (dd <= 3 * 86400000 && dd < bestDelta) { bestDelta = dd; match = e; }
      }
    }
    if (match) { match.used = true; usedMeta++; const arr = okByNote.get(match.note) ?? []; arr.push(t.id); okByNote.set(match.note, arr); }
    else leakIds.push(t.id);
  }

  for (const t of txs) if (!(t.isMetaCharge || META_RE.test(t.description)) && t.metaCheck) clearIds.push(t.id);

  const applyMany = async (ids: string[], data: Record<string, unknown>) => {
    for (let i = 0; i < ids.length; i += 200) await prisma.transaction.updateMany({ where: { id: { in: ids.slice(i, i + 200) } }, data });
  };
  let okCount = 0;
  for (const [note, ids] of okByNote) { await applyMany(ids, { metaCheck: "ok", metaCheckNote: note }); okCount += ids.length; }
  await applyMany(leakIds, { metaCheck: "leak", metaCheckNote: null });
  await applyMany(reviewIds, { metaCheck: "review", metaCheckNote: null });
  await applyMany(clearIds, { metaCheck: null, metaCheckNote: null });

  return { metaTx: okCount + leakIds.length + reviewIds.length, ok: okCount, leak: leakIds.length, review: reviewIds.length, metaUnmatched: metaCharges.length - usedMeta };
}
