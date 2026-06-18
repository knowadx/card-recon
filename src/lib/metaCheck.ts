/**
 * Helpers de checagem Meta (anti-vazamento de cartão).
 * Usados no import (classificar cobrança Meta + capturar last4) e na checagem.
 */

export const META_RE = /facebook|facebk|meta\s*platform|meta\s*ads|meta\s*pay|\bmeta\b/i;

/**
 * Transferências/faturas pra entidade legal da Meta ("Meta Platforms Ireland Limited") — NÃO são
 * cobrança de cartão (são wire/fatura), então ficam de fora da checagem de cartão.
 */
export const META_TRANSFER_RE = /meta\s*platforms?\s*ireland/i;

export function isMetaMerchant(...parts: (string | null | undefined)[]): boolean {
  const text = parts.filter(Boolean).join(" ");
  if (META_TRANSFER_RE.test(text)) return false;
  return parts.some((p) => p && META_RE.test(p));
}

export function last4Of(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value);
  const m = s.match(/(\d{4})(?!.*\d)/);
  return m ? m[1] : null;
}
