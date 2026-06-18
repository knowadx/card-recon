import { prisma } from "./db";
import { META_RE } from "./metaCheck";

/**
 * Matching extrato × cobranças reais do Meta (MetaBillingCharge).
 * Casa cada cobrança Meta do banco (em USD via billAmount) com uma cobrança real de uma conta
 * que você controla, por VALOR + DATA (±3 dias, tolerância de US$1). É o coração do antifraude:
 *   - ok     → bateu com cobrança de uma conta/BM sua (atribuída, com nome)
 *   - leak   → cobrança no cartão SEM par em nenhuma conta sua (foi pra conta que não é sua)
 *   - review → cobrança sem valor USD (billAmount) — re-sincronize o banco
 */
export async function runChargeMatch(): Promise<{ metaTx: number; ok: number; leak: number; review: number; metaUnmatched: number }> {
  const [metaCharges, txs] = await Promise.all([
    prisma.metaBillingCharge.findMany({ select: { id: true, amountUsd: true, chargedAt: true, accountName: true, bmName: true } }),
    prisma.transaction.findMany({
      select: { id: true, date: true, description: true, isMetaCharge: true, billAmount: true, billCurrency: true, metaCheck: true },
    }),
  ]);

  // buckets por valor (dólar inteiro) p/ busca rápida; cada cobrança Meta usada 1x
  const buckets = new Map<number, { used: boolean; amountUsd: number; chargedAt: Date; note: string }[]>();
  for (const m of metaCharges) {
    const key = Math.round(m.amountUsd);
    const note = `Conta ${m.accountName ?? "?"}${m.bmName ? ` · BM ${m.bmName}` : ""} · cobrança US$ ${m.amountUsd.toFixed(2)} em ${m.chargedAt.toISOString().slice(0, 10)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ used: false, amountUsd: m.amountUsd, chargedAt: m.chargedAt, note });
  }

  const okByNote: { id: string; note: string }[] = [];
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = [];
  let usedMeta = 0;

  // ordena por data p/ matching guloso estável
  const bank = txs.filter((t) => t.isMetaCharge || META_RE.test(t.description)).sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const t of bank) {
    // só casa em USD (billAmount). billCurrency null assume USD (cobrança Meta é USD).
    const usd = t.billAmount != null && (!t.billCurrency || t.billCurrency === "USD") ? t.billAmount : null;
    if (usd == null) { reviewIds.push(t.id); continue; }

    let match: { used: boolean; note: string } | null = null;
    let bestDelta = Infinity;
    for (const k of [Math.round(usd), Math.round(usd) - 1, Math.round(usd) + 1]) {
      const arr = buckets.get(k);
      if (!arr) continue;
      for (const e of arr) {
        if (e.used || Math.abs(e.amountUsd - usd) > 1.0) continue;
        const dd = Math.abs(e.chargedAt.getTime() - t.date.getTime());
        if (dd <= 3 * 86400000 && dd < bestDelta) { bestDelta = dd; match = e; }
      }
    }
    if (match) { match.used = true; usedMeta++; okByNote.push({ id: t.id, note: match.note }); }
    else leakIds.push(t.id);
  }

  // transações não-Meta com status antigo → limpa
  for (const t of txs) if (!(t.isMetaCharge || META_RE.test(t.description)) && t.metaCheck) clearIds.push(t.id);

  const applyMany = async (ids: string[], data: Record<string, unknown>) => {
    for (let i = 0; i < ids.length; i += 200) await prisma.transaction.updateMany({ where: { id: { in: ids.slice(i, i + 200) } }, data });
  };
  // ok tem nota individual → atualiza 1x1 (cada cobrança aponta sua conta/BM)
  for (const { id, note } of okByNote) await prisma.transaction.update({ where: { id }, data: { metaCheck: "ok", metaCheckNote: note } });
  await applyMany(leakIds, { metaCheck: "leak", metaCheckNote: null });
  await applyMany(reviewIds, { metaCheck: "review", metaCheckNote: null });
  await applyMany(clearIds, { metaCheck: null, metaCheckNote: null });

  return { metaTx: okByNote.length + leakIds.length + reviewIds.length, ok: okByNote.length, leak: leakIds.length, review: reviewIds.length, metaUnmatched: metaCharges.length - usedMeta };
}
