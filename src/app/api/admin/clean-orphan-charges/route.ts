import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/clean-orphan-charges — cobranças órfãs = MetaBillingCharge cujo accountId
 * NÃO está entre as contas atuais (MetaAdAccount). Sobram de syncs antigos/escopo trocado e
 * inflam o total do "Meta diz".
 *   - sem ?apply=1 → DRY-RUN: só lista o que apagaria (prova antes de apagar).
 *   - com ?apply=1 → apaga de verdade.
 * Exige usuário logado.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apply = new URL(request.url).searchParams.get("apply") === "1";

  const accounts = await prisma.metaAdAccount.findMany({ select: { accountId: true } });
  const validIds = accounts.map((a) => a.accountId);
  // trava de segurança: sem contas atuais, NÃO apago nada (senão apagaria tudo)
  if (validIds.length === 0) {
    return NextResponse.json({ error: "sem MetaAdAccount — rode o Sincronizar Meta antes; não vou apagar nada às cegas" }, { status: 400 });
  }

  const where = { accountId: { notIn: validIds } };
  const orphans = await prisma.metaBillingCharge.findMany({
    where,
    select: { accountId: true, accountName: true, amountUsd: true, currency: true, chargedAt: true },
  });

  // resumo por conta órfã
  const byAccount = new Map<string, { accountId: string; accountName: string | null; count: number; firstAt: string; lastAt: string }>();
  for (const c of orphans) {
    let row = byAccount.get(c.accountId);
    const d = c.chargedAt.toISOString().slice(0, 10);
    if (!row) { row = { accountId: c.accountId, accountName: c.accountName, count: 0, firstAt: d, lastAt: d }; byAccount.set(c.accountId, row); }
    row.count++;
    if (d < row.firstAt) row.firstAt = d;
    if (d > row.lastAt) row.lastAt = d;
  }
  const resumo = Array.from(byAccount.values()).sort((a, b) => b.count - a.count);

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      contasAtuais: validIds.length,
      cobrancasOrfas: orphans.length,
      contasOrfas: resumo.length,
      resumo,
      comoApagar: "abra a mesma URL com ?apply=1 no fim",
    });
  }

  const del = await prisma.metaBillingCharge.deleteMany({ where });
  return NextResponse.json({ apagadas: del.count, contasOrfas: resumo.length, resumo });
}
