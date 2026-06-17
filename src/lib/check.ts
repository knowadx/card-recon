import { prisma } from "./db";
import { META_RE } from "./metaCheck";

/**
 * Checagem anti-vazamento (direção CERTA): parte das cobranças do extrato.
 * Para cada transação Meta:
 *   - ok     → o cartão financia uma conta Meta controlada OU está na whitelist
 *   - leak   → cobrança Meta num cartão que NÃO é de nenhuma conta controlada nem
 *              está na whitelist (possível cartão vazado / uso por terceiro)
 *   - review → cobrança Meta sem cartão identificado (não dá pra atribuir)
 */
export async function runMetaCheck(): Promise<{
  metaTx: number;
  ok: number;
  leak: number;
  review: number;
}> {
  const [metaAccts, whitelist, txs] = await Promise.all([
    prisma.metaAdAccount.findMany({ select: { fundingCardLast4: true, accountId: true, bmId: true, bmName: true } }),
    prisma.cardWhitelist.findMany({ select: { last4: true, label: true } }),
    prisma.transaction.findMany({
      select: { id: true, description: true, isMetaCharge: true, cardLast4: true, metaCheck: true },
    }),
  ]);

  // Combinação validada: cartão (last4) → nota da conta/BM que valida.
  // Origem auto = funding das contas Meta controladas; origem manual = whitelist.
  const comboByCard = new Map<string, string>();
  for (const a of metaAccts) {
    if (a.fundingCardLast4 && !comboByCard.has(a.fundingCardLast4)) {
      comboByCard.set(a.fundingCardLast4, `Conta ${a.accountId}${a.bmName ? ` · BM ${a.bmName}` : a.bmId ? ` · BM ${a.bmId}` : ""}`);
    }
  }
  for (const w of whitelist) {
    if (!comboByCard.has(w.last4)) comboByCard.set(w.last4, `whitelist${w.label ? ` (${w.label})` : ""}`);
  }
  const legit = new Set<string>(comboByCard.keys());

  const okByNote = new Map<string, string[]>(); // nota → ids (auditoria do que validou)
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = [];
  const flagMetaIds: string[] = [];

  for (const t of txs) {
    const isMeta = t.isMetaCharge || META_RE.test(t.description);
    if (!isMeta) {
      if (t.metaCheck) clearIds.push(t.id);
      continue;
    }
    if (!t.isMetaCharge) flagMetaIds.push(t.id);
    if (!t.cardLast4) reviewIds.push(t.id);
    else if (legit.has(t.cardLast4)) {
      const note = comboByCard.get(t.cardLast4)!;
      const arr = okByNote.get(note) ?? [];
      arr.push(t.id);
      okByNote.set(note, arr);
    } else leakIds.push(t.id);
  }

  const apply = async (ids: string[], data: Record<string, unknown>) => {
    for (let i = 0; i < ids.length; i += 200) {
      await prisma.transaction.updateMany({ where: { id: { in: ids.slice(i, i + 200) } }, data });
    }
  };
  await apply(flagMetaIds, { isMetaCharge: true });
  let okCount = 0;
  for (const [note, ids] of okByNote) {
    await apply(ids, { metaCheck: "ok", metaCheckNote: note });
    okCount += ids.length;
  }
  await apply(leakIds, { metaCheck: "leak", metaCheckNote: null });
  await apply(reviewIds, { metaCheck: "review", metaCheckNote: null });
  await apply(clearIds, { metaCheck: null, metaCheckNote: null });

  return { metaTx: okCount + leakIds.length + reviewIds.length, ok: okCount, leak: leakIds.length, review: reviewIds.length };
}
