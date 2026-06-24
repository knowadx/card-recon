import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/find-duplicates — só leitura. Acha possíveis transações duplicadas:
 * mesma conta + dia + valor + descrição, mas com `reference` diferente (sinal de import
 * pela API E por CSV, p.ex.). NÃO apaga nada — só lista.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const txs = await prisma.transaction.findMany({
    select: { id: true, accountId: true, date: true, amount: true, description: true, reference: true, metaRef: true,
      account: { select: { name: true } } },
  });

  const groups = new Map<string, typeof txs>();
  for (const t of txs) {
    const key = `${t.accountId}|${t.date.toISOString().slice(0, 10)}|${t.amount}|${t.description}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const dups = [...groups.values()]
    .filter((g) => g.length > 1 && new Set(g.map((t) => t.reference)).size > 1) // >1 registro com refs distintas
    .map((g) => ({
      account: g[0].account?.name ?? null,
      date: g[0].date.toISOString().slice(0, 10),
      amount: g[0].amount,
      description: g[0].description,
      copias: g.length,
      references: g.map((t) => t.reference),
    }))
    .sort((a, b) => b.copias - a.copias);

  const totalExtra = dups.reduce((s, d) => s + (d.copias - 1), 0);
  return NextResponse.json({
    transacoes: txs.length,
    gruposDuplicados: dups.length,
    registrosExtras: totalExtra, // quanto está sendo contado a mais
    amostra: dups.slice(0, 100),
  });
}
