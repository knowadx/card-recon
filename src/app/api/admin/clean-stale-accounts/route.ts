import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/clean-stale-accounts — remove MetaAdAccount "vazias": sem operação
 * (operationId null) E sem nenhuma cobrança (MetaBillingCharge). São registros de sync
 * antigo (company "default") que só inflam a contagem de contas.
 *   - sem ?apply=1 → DRY-RUN (só mostra).
 *   - com ?apply=1 → apaga.
 * NUNCA apaga conta que tenha cobrança. Exige login.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apply = new URL(request.url).searchParams.get("apply") === "1";

  // accountIds que TÊM cobrança → nunca apagar
  const charged = await prisma.metaBillingCharge.findMany({ select: { accountId: true }, distinct: ["accountId"] });
  const chargedIds = charged.map((c) => c.accountId);

  const where = { operationId: null, accountId: { notIn: chargedIds } };
  const stale = await prisma.metaAdAccount.findMany({
    where,
    select: { accountId: true, name: true, company: true },
  });

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      removeria: stale.length,
      amostra: stale.slice(0, 20),
      comoApagar: "abra a mesma URL com ?apply=1 no fim",
    });
  }

  const del = await prisma.metaAdAccount.deleteMany({ where });
  return NextResponse.json({ apagadas: del.count });
}
