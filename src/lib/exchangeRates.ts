import { prisma } from "@/lib/db";

// Returns a map of "CURRENCY:YYYY-MM" -> rateToUsd
// USD is always 1.0
export async function loadRateMap(): Promise<Record<string, number>> {
  const rates = await prisma.exchangeRate.findMany();
  const map: Record<string, number> = {};
  for (const r of rates) {
    map[`${r.currency}:${r.month}`] = r.rateToUsd;
  }
  return map;
}

export function toUsd(amount: number, currency: string, month: string, rateMap: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rateMap[`${currency}:${month}`];
  if (!rate) return amount; // fallback: return original if no rate
  return amount * rate;
}
