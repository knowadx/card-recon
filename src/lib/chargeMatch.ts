import { prisma } from "./db";
import { META_RE, META_TRANSFER_RE } from "./metaCheck";

/** Piso de data da Checagem: só consideramos cobranças de maio/2026 em diante. */
export const CHECK_FLOOR = new Date("2026-05-01T00:00:00.000Z");

/**
 * Matching extrato × cobranças reais do Meta (MetaBillingCharge), por MOEDA + VALOR EXATO + DATA.
 * EXCLUSIVO: cada cobrança Meta é consumida 1×. Casa por moeda + valor exato (centavos) + data
 * mais próxima (±3 dias, p/ defasagem de liquidação). Assim, se o extrato cobrou MAIS vezes do que
 * o Meta registrou (duplicata/fraude/sem cobertura), o excesso fica 🔴 — não é mascarado.
 *
 *   - ok     → casou com uma cobrança Meta livre (atribui a conta/BM)
 *   - leak   → SEM cobrança Meta livre e o valor é confiável em USD (billAmount, ou conta USD) → suspeito
 *   - review → SEM par e sem valor USD confiável (ex.: cobrança EUR sem billAmount) → re-sync do banco
 */
export async function runChargeMatch(): Promise<{ metaTx: number; ok: number; leak: number; review: number }> {
  const [metaCharges, txs] = await Promise.all([
    prisma.metaBillingCharge.findMany({ where: { chargedAt: { gte: CHECK_FLOOR } }, select: { amountUsd: true, currency: true, chargedAt: true, accountName: true, bmName: true } }),
    prisma.transaction.findMany({
      where: { date: { gte: CHECK_FLOOR } },
      select: { id: true, date: true, description: true, isMetaCharge: true, amount: true, currency: true, billAmount: true, billCurrency: true, metaCheck: true },
    }),
  ]);

  // buckets por "MOEDA|valor em centavos" (valor EXATO, sem tolerância) → cobranças Meta, consumíveis 1x
  const buckets = new Map<string, { used: boolean; chargedAt: number; note: string }[]>();
  const keyOf = (cur: string, vCents: number) => `${cur}|${vCents}`;
  for (const m of metaCharges) {
    const note = `Conta ${m.accountName ?? "?"}${m.bmName ? ` · BM ${m.bmName}` : ""}`;
    const k = keyOf(m.currency, Math.round(m.amountUsd * 100));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push({ used: false, chargedAt: m.chargedAt.getTime(), note });
  }

  const okByNote = new Map<string, string[]>();
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = [];
  const WINDOW = 3 * 86400000; // ±3 dias (defasagem de liquidação)

  // cobrança de CARTÃO Meta (exclui transferências/faturas "Meta Platforms Ireland")
  const isCardCharge = (t: { isMetaCharge: boolean; description: string }) =>
    (t.isMetaCharge || META_RE.test(t.description)) && !META_TRANSFER_RE.test(t.description);
  // ordena por data p/ pareamento estável (cada cobrança Meta consumida 1x = pega excesso/duplicata)
  const bank = txs.filter(isCardCharge).sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const t of txs) if (!isCardCharge(t) && t.metaCheck) clearIds.push(t.id);

  for (const t of bank) {
    // moeda+valor p/ casar: billAmount (moeda original da Meta) tem prioridade; senão o da transação
    const usable = t.billAmount != null;
    const amt = usable ? t.billAmount! : Math.abs(t.amount);
    const cur = (usable ? t.billCurrency : t.currency) || t.currency;
    const tt = t.date.getTime();

    const arr = buckets.get(keyOf(cur, Math.round(amt * 100)));
    let match: { used: boolean; note: string } | null = null;
    let bestDelta = Infinity;
    if (arr) {
      for (const e of arr) {
        if (e.used) continue;
        const dd = Math.abs(e.chargedAt - tt);
        if (dd <= WINDOW && dd < bestDelta) { bestDelta = dd; match = e; }
      }
    }
    if (match) { match.used = true; const a = okByNote.get(match.note) ?? []; a.push(t.id); okByNote.set(match.note, a); }
    else if (usable || cur === "USD") leakIds.push(t.id); // valor confiável e sem par livre → suspeito (excesso)
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
