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

/**
 * Período de sincronização — ÚNICA fonte de verdade, configurada na UI (/checagem).
 * Todos os syncs (Meta/Revolut/Wise/Mercury/all) e o piso da Checagem leem daqui.
 * Nada de janela hardcoded (30/90 dias, 3 meses). Default inicial só até o usuário setar.
 */
export const SYNC_FROM_KEY = "sync.from";
export const SYNC_TO_KEY = "sync.to";
const SYNC_FROM_DEFAULT = "2026-05-01"; // valor inicial; usuário troca na UI

/** { from: "YYYY-MM-DD", to: "YYYY-MM-DD" | null }. `to` null = até hoje. */
export async function getSyncPeriod(): Promise<{ from: string; to: string | null }> {
  const [from, to] = await Promise.all([getSetting(SYNC_FROM_KEY), getSetting(SYNC_TO_KEY)]);
  return { from: from || SYNC_FROM_DEFAULT, to: to || null };
}

export async function setSyncPeriod(from: string, to: string | null): Promise<void> {
  if (from) await setSetting(SYNC_FROM_KEY, from);
  await setSetting(SYNC_TO_KEY, to || "");
}

/** Piso de data da Checagem = início do período de sync. */
export async function getCheckFloor(): Promise<Date> {
  const { from } = await getSyncPeriod();
  const d = new Date(`${from}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? new Date(`${SYNC_FROM_DEFAULT}T00:00:00.000Z`) : d;
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
