import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metaref-analyze — análise estrutural do metaRef com volume.
 * Para cada POSIÇÃO (0-9) do código: quantos caracteres distintos globalmente, e — por
 * cartão (last4) — em quais posições o cartão é constante (= posições que codificam o cartão).
 * Também: para cada posição, se o caractere mapeia 1:1 pra um único last4 (posição discriminante).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await prisma.transaction.findMany({
    where: { metaRef: { not: null }, cardLast4: { not: null } },
    select: { metaRef: true, cardLast4: true },
  });
  const codes = rows.filter((r) => r.metaRef!.length === 10) as { metaRef: string; cardLast4: string }[];

  const L = 10;
  // 1) entropia global por posição
  const globalChars: Set<string>[] = Array.from({ length: L }, () => new Set());
  // 2) char->last4 por posição (pra ver se a posição é discriminante de cartão)
  const charToCards: Map<string, Set<string>>[] = Array.from({ length: L }, () => new Map());
  // 3) por cartão: chars por posição
  const byCard: Record<string, Set<string>[]> = {};

  for (const { metaRef, cardLast4 } of codes) {
    if (!byCard[cardLast4]) byCard[cardLast4] = Array.from({ length: L }, () => new Set());
    for (let i = 0; i < L; i++) {
      const ch = metaRef[i];
      globalChars[i].add(ch);
      byCard[cardLast4][i].add(ch);
      const m = charToCards[i];
      if (!m.has(ch)) m.set(ch, new Set());
      m.get(ch)!.add(cardLast4);
    }
  }

  const posGlobal = globalChars.map((s, i) => ({ pos: i, distintos: s.size }));
  // posição discriminante: todo caractere naquela posição aparece em no máx 1 cartão
  const posDiscriminante = charToCards.map((m, i) => ({
    pos: i,
    discrimina: [...m.values()].every((cards) => cards.size === 1),
    charsAmbiguos: [...m.entries()].filter(([, cards]) => cards.size > 1).map(([c, cards]) => `${c}:${[...cards].join("/")}`).slice(0, 8),
  }));
  // por cartão: posições constantes (1 char) = candidatas a "do cartão"
  const cartoes = Object.entries(byCard).map(([last4, positions]) => ({
    last4,
    n: codes.filter((c) => c.cardLast4 === last4).length,
    posicoesConstantes: positions.map((s, i) => (s.size === 1 ? i : -1)).filter((i) => i >= 0),
    valoresConstantes: positions.map((s) => (s.size === 1 ? [...s][0] : `(${s.size})`)).join(" "),
  }));

  return NextResponse.json({ totalCodigos: codes.length, posGlobal, posDiscriminante, cartoes });
}
