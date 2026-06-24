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

/**
 * Extrai o código do descritor Meta do extrato — ex.: "Facebk *cxvy4wh7m2" → "cxvy4wh7m2".
 * É o hash que o Meta carimba na cobrança ([4 transação][3 conta][3 cartão]). Retorna o 1º
 * que achar entre os textos passados (merchant/description/reference), ou null.
 */
const META_REF_RE = /faceb[a-z]*\s*\*\s*([A-Za-z0-9]{6,})/i;
export function extractMetaRef(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    if (!p) continue;
    const m = p.match(META_REF_RE);
    if (m) return m[1];
  }
  return null;
}

export function last4Of(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value);
  const m = s.match(/(\d{4})(?!.*\d)/);
  return m ? m[1] : null;
}
