/**
 * Helpers de checagem Meta (anti-vazamento de cartão).
 * Usados no import (classificar cobrança Meta + capturar last4) e na checagem.
 */

export const META_RE = /facebook|facebk|meta\s*platform|meta\s*ads|\bmeta\b/i;

export function isMetaMerchant(...parts: (string | null | undefined)[]): boolean {
  return parts.some((p) => p && META_RE.test(p));
}

export function last4Of(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value);
  const m = s.match(/(\d{4})(?!.*\d)/);
  return m ? m[1] : null;
}
