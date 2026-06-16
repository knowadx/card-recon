import { prisma } from "./db";

/**
 * Lê uma configuração: primeiro do DB (Setting), senão da env var de fallback.
 * Permite trocar tokens pela tela /settings sem mexer no .env.
 */
export async function getSetting(key: string, envFallback?: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row?.value) return row.value;
  if (envFallback && process.env[envFallback]) return process.env[envFallback]!;
  return null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Tolerância de divergência (fração, ex 0.02 = 2%). Default 2%. */
export async function getTolerance(): Promise<number> {
  const v = await getSetting("recon.tolerancePct");
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0.02;
}

/** Regex (string) que classifica uma cobrança como sendo do Meta. */
export async function getMetaMerchantPattern(): Promise<RegExp> {
  const v = (await getSetting("recon.metaMerchantPattern")) || "facebook|facebk|meta\\s*platform|meta\\s*ads|meta\\b";
  try {
    return new RegExp(v, "i");
  } catch {
    return /facebook|facebk|meta/i;
  }
}
