import { prisma } from "@/lib/db";
import { AccessError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { fimDoMes, inicioDoMes } from "@/lib/cobertura";

/**
 * GET /api/coverage/detalhe?accountId=&mes=AAAA-MM — o que provou (ou não) a importação da conta no mês:
 * cada importação cujo trecho toca o mês (de/até, API ou OFX, arquivo, quem e quando).
 */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores veem o Control");
  const params = new URL(request.url).searchParams;
  const accountId = params.get("accountId") ?? "";
  const mes = params.get("mes") ?? "";
  await assertAccount(user, accountId);
  if (!/^\d{4}-\d{2}$/.test(mes)) return Response.json({ error: "mes=AAAA-MM" }, { status: 400 });
  const ini = inicioDoMes(mes);
  const fim = fimDoMes(mes);
  const importacoes = await prisma.importCoverage.findMany({
    where: { accountId, from: { lt: fim }, to: { gt: ini } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { from: true, to: true, source: true, createdAt: true, user: { select: { name: true, email: true } }, importLog: { select: { filename: true } } },
  });
  return Response.json({
    importacoes: importacoes.map((i) => ({
      de: i.from.toISOString(),
      ate: i.to.toISOString(),
      fonte: i.source,
      quando: i.createdAt.toISOString(),
      quem: i.user?.name || i.user?.email || null,
      arquivo: i.importLog?.filename ?? null,
    })),
  });
});
