import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/meta-accounts-audit — só leitura. Agrupa MetaAdAccount por operação e
 * marca quais NÃO têm credencial Meta ativa (perfil antigo/desconectado). Mostra também
 * quantas cobranças cada grupo tem. Serve p/ decidir o que é "stale" antes de limpar.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [accounts, creds, charges] = await Promise.all([
    prisma.metaAdAccount.findMany({ select: { accountId: true, operationId: true, company: true } }),
    prisma.credential.findMany({ where: { issuer: "meta", isActive: true }, select: { operationId: true } }),
    prisma.metaBillingCharge.findMany({ select: { operationId: true } }),
  ]);

  const activeOps = new Set(creds.map((c) => c.operationId).filter(Boolean) as string[]);
  // nomes das operações p/ exibir
  const ops = await prisma.operation.findMany({ select: { id: true, name: true } });
  const opName = new Map(ops.map((o) => [o.id, o.name]));

  const chargesByOp = new Map<string, number>();
  for (const c of charges) { const k = c.operationId ?? "—"; chargesByOp.set(k, (chargesByOp.get(k) ?? 0) + 1); }

  const groups = new Map<string, { operationId: string | null; operacao: string | null; company: string | null; contas: number; comCredencialAtiva: boolean }>();
  for (const a of accounts) {
    const k = a.operationId ?? "—";
    let g = groups.get(k);
    if (!g) {
      g = {
        operationId: a.operationId,
        operacao: a.operationId ? opName.get(a.operationId) ?? null : null,
        company: a.company,
        contas: 0,
        comCredencialAtiva: a.operationId ? activeOps.has(a.operationId) : false,
      };
      groups.set(k, g);
    }
    g.contas++;
  }

  const grupos = Array.from(groups.entries())
    .map(([k, g]) => ({ ...g, cobrancas: chargesByOp.get(k) ?? 0 }))
    .sort((a, b) => Number(a.comCredencialAtiva) - Number(b.comCredencialAtiva) || b.contas - a.contas);

  return NextResponse.json({
    totalContas: accounts.length,
    totalCobrancas: charges.length,
    grupos, // grupos sem credencial ativa = candidatos a limpeza
  });
}
