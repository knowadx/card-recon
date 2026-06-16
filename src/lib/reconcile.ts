import { prisma } from "./db";
import { resolvePeriod } from "./period";
import { getTolerance } from "./settings";

export type AlertLevel = "red" | "amber";

/**
 * Semântica (decisão do usuário jun/16): o REGISTRO DE BANCOS (Wise/Mercury/Revolut)
 * é a verdade dos cartões legítimos.
 *  - unregistered: conta Meta financiada por um cartão que NÃO está em nenhum banco
 *    seu → sinal de vazamento/clone (ou banco ainda não integrado). VERMELHO.
 *  - divergence: cartão casado, mas o cobrado diverge do spend além da tolerância. ÂMBAR.
 *  - unmatched_charge: cobrança Meta num cartão SEU que não bate com nenhuma conta
 *    visível (o Meta só expõe funding de parte das contas) → NEUTRO (info), não alarme.
 *  - no_charge: conta com spend mas sem cobrança vista (timing/limiar/banco não synced). NEUTRO.
 *  - ok: bate dentro da tolerância.
 */
export type ReconStatus = "ok" | "divergence" | "unregistered" | "unmatched_charge" | "no_charge";

export interface ReconAccount {
  id: string;
  name: string;
  bmId: string | null;
  bmName: string | null;
  currency: string;
  spend: number;
  last4: string | null;
  brand: string | null;
}

export interface CardRecon {
  last4: string;
  brands: string[];
  issuers: string[];
  label: string | null;
  cardKnown: boolean;
  accounts: ReconAccount[];
  expectedSpend: number;
  actualCharged: number;
  chargeCount: number;
  diff: number;
  diffPct: number | null;
  currencies: string[];
  status: ReconStatus;
}

export interface Alert {
  level: AlertLevel;
  kind: ReconStatus;
  title: string;
  detail: string;
  last4: string | null;
}

export interface ReconResult {
  period: string;
  tolerancePct: number;
  cards: CardRecon[];
  byBM: { bmId: string | null; bmName: string; totalSpend: number; accounts: ReconAccount[] }[];
  alerts: Alert[];
  totals: { expectedSpend: number; actualCharged: number; mixedCurrency: boolean };
  // Cobranças Meta SEM cartão (wires/transferências) — pagamento real ao Meta sem cartão
  metaChargesNoCard: { count: number; total: number; items: { issuer: string; company: string | null; date: string; amount: number; currency: string; merchant: string | null }[] };
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function reconcile(periodKey?: string | null): Promise<ReconResult> {
  const period = resolvePeriod(periodKey);
  const tolerancePct = await getTolerance();

  const [accounts, cards, charges] = await Promise.all([
    prisma.adAccount.findMany({
      include: { bm: true, snapshots: { where: { periodStart: period.start, periodEnd: period.end } } },
    }),
    prisma.card.findMany(),
    prisma.bankCharge.findMany({
      where: { isMetaCharge: true, date: { gte: period.start, lte: period.end } },
    }),
  ]);

  const cardsByLast4 = new Map<string, typeof cards>();
  for (const c of cards) {
    const arr = cardsByLast4.get(c.last4) ?? [];
    arr.push(c);
    cardsByLast4.set(c.last4, arr);
  }

  // Cobranças com cartão vs sem cartão (wires)
  const chargesByLast4 = new Map<string, typeof charges>();
  const noCardCharges: typeof charges = [];
  for (const ch of charges) {
    if (ch.cardLast4) {
      const arr = chargesByLast4.get(ch.cardLast4) ?? [];
      arr.push(ch);
      chargesByLast4.set(ch.cardLast4, arr);
    } else {
      noCardCharges.push(ch);
    }
  }

  const reconAccounts: ReconAccount[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    bmId: a.bmId,
    bmName: a.bm?.name ?? null,
    currency: a.currency,
    spend: a.snapshots[0]?.spend ?? 0,
    last4: a.fundingCardLast4,
    brand: a.fundingCardBrand,
  }));

  const accountsByLast4 = new Map<string, ReconAccount[]>();
  for (const ra of reconAccounts) {
    if (!ra.last4) continue;
    const arr = accountsByLast4.get(ra.last4) ?? [];
    arr.push(ra);
    accountsByLast4.set(ra.last4, arr);
  }

  const allLast4 = new Set<string>([...accountsByLast4.keys(), ...chargesByLast4.keys()]);

  const cardsRecon: CardRecon[] = [];
  const alerts: Alert[] = [];

  for (const last4 of allLast4) {
    const accs = accountsByLast4.get(last4) ?? [];
    const chs = chargesByLast4.get(last4) ?? [];
    const known = cardsByLast4.get(last4) ?? [];

    const expectedSpend = accs.reduce((s, a) => s + a.spend, 0);
    const actualCharged = chs.reduce((s, c) => s + Math.abs(c.amount), 0);
    const diff = actualCharged - expectedSpend;
    const diffPct = expectedSpend > 0 ? diff / expectedSpend : null;
    const currencies = Array.from(new Set([...accs.map((a) => a.currency), ...chs.map((c) => c.currency)]));

    let status: ReconStatus;
    if (accs.length > 0 && known.length === 0) {
      status = "unregistered"; // conta financiada por cartão fora do registro de bancos
    } else if (accs.length === 0) {
      status = "unmatched_charge"; // cobrança Meta sem conta visível (Meta parcial) — neutro
    } else if (actualCharged === 0) {
      status = "no_charge";
    } else if (Math.abs(diff) > tolerancePct * expectedSpend && Math.abs(diff) > 1) {
      status = "divergence";
    } else {
      status = "ok";
    }

    cardsRecon.push({
      last4,
      brands: Array.from(new Set([...accs.map((a) => a.brand), ...known.map((k) => k.brand)].filter(Boolean) as string[])),
      issuers: Array.from(new Set(known.map((k) => k.issuer))),
      label: known.find((k) => k.label)?.label ?? null,
      cardKnown: known.length > 0,
      accounts: accs,
      expectedSpend,
      actualCharged,
      chargeCount: chs.length,
      diff,
      diffPct,
      currencies,
      status,
    });

    if (status === "unregistered") {
      alerts.push({
        level: "red",
        kind: "unregistered",
        last4,
        title: `Cartão fora do registro •${last4}`,
        detail: `${accs.length} conta(s) Meta financiada(s) pelo cartão •${last4}, que NÃO está em nenhum banco seu (Wise/Mercury/Revolut). Pode ser cartão vazado/de terceiro — ou um banco ainda não integrado.`,
      });
    } else if (status === "divergence") {
      alerts.push({
        level: "amber",
        kind: "divergence",
        last4,
        title: `Divergência no cartão •${last4}`,
        detail: `Cobrado ${fmt(actualCharged)} × spend ${fmt(expectedSpend)} (dif ${fmt(diff)}${diffPct !== null ? `, ${(diffPct * 100).toFixed(0)}%` : ""}), acima da tolerância de ${(tolerancePct * 100).toFixed(0)}%.`,
      });
    }
  }

  const statusRank: Record<ReconStatus, number> = {
    unregistered: 0,
    divergence: 1,
    no_charge: 2,
    unmatched_charge: 3,
    ok: 4,
  };
  cardsRecon.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.actualCharged - a.actualCharged);
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));

  // Por BM
  const bmMap = new Map<string, ReconResult["byBM"][number]>();
  for (const ra of reconAccounts) {
    const key = ra.bmId ?? "__none__";
    const entry = bmMap.get(key) ?? { bmId: ra.bmId, bmName: ra.bmName ?? "Sem BM", totalSpend: 0, accounts: [] };
    entry.accounts.push(ra);
    entry.totalSpend += ra.spend;
    bmMap.set(key, entry);
  }
  const byBM = Array.from(bmMap.values()).sort((a, b) => b.totalSpend - a.totalSpend);

  const expectedTotal = reconAccounts.reduce((s, a) => s + a.spend, 0);
  const actualTotal = charges.reduce((s, c) => s + Math.abs(c.amount), 0);
  const mixedCurrency = new Set([...reconAccounts.map((a) => a.currency), ...charges.map((c) => c.currency)]).size > 1;

  const noCardTotal = noCardCharges.reduce((s, c) => s + Math.abs(c.amount), 0);

  return {
    period: period.key,
    tolerancePct,
    cards: cardsRecon,
    byBM,
    alerts,
    totals: { expectedSpend: expectedTotal, actualCharged: actualTotal, mixedCurrency },
    metaChargesNoCard: {
      count: noCardCharges.length,
      total: noCardTotal,
      items: noCardCharges
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 50)
        .map((c) => ({
          issuer: c.issuer,
          company: c.company,
          date: c.date.toISOString().slice(0, 10),
          amount: Math.abs(c.amount),
          currency: c.currency,
          merchant: c.merchantRaw,
        })),
    },
  };
}
