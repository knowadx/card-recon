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
    prisma.metaAdAccount.findMany({ select: { fundingCardLast4: true } }),
    prisma.cardWhitelist.findMany({ select: { last4: true } }),
    prisma.transaction.findMany({
      select: { id: true, description: true, isMetaCharge: true, cardLast4: true, metaCheck: true },
    }),
  ]);

  const legit = new Set<string>(
    [...metaAccts.map((a) => a.fundingCardLast4), ...whitelist.map((w) => w.last4)].filter(
      (x): x is string => !!x,
    ),
  );

  const okIds: string[] = [];
  const leakIds: string[] = [];
  const reviewIds: string[] = [];
  const clearIds: string[] = []; // não-Meta → limpa metaCheck
  const flagMetaIds: string[] = []; // detectado Meta pela descrição mas flag false

  for (const t of txs) {
    const isMeta = t.isMetaCharge || META_RE.test(t.description);
    if (!isMeta) {
      if (t.metaCheck) clearIds.push(t.id);
      continue;
    }
    if (!t.isMetaCharge) flagMetaIds.push(t.id);
    if (!t.cardLast4) reviewIds.push(t.id);
    else if (legit.has(t.cardLast4)) okIds.push(t.id);
    else leakIds.push(t.id);
  }

  // aplica (updateMany em lote por status)
  const apply = async (ids: string[], data: Record<string, unknown>) => {
    for (let i = 0; i < ids.length; i += 200) {
      await prisma.transaction.updateMany({ where: { id: { in: ids.slice(i, i + 200) } }, data });
    }
  };
  await apply(flagMetaIds, { isMetaCharge: true });
  await apply(okIds, { metaCheck: "ok" });
  await apply(leakIds, { metaCheck: "leak" });
  await apply(reviewIds, { metaCheck: "review" });
  await apply(clearIds, { metaCheck: null });

  return { metaTx: okIds.length + leakIds.length + reviewIds.length, ok: okIds.length, leak: leakIds.length, review: reviewIds.length };
}
