import { prisma } from "@/lib/db";
import { AccessError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { apenasDigitos, btgListarContas, BtgNaoConfigurado, BtgSemConsentimento } from "@/lib/btg";

export const dynamic = "force-dynamic";

/** GET /api/btg/contas?accountId= — contas no BTG da empresa daquela conta (pra escolher qual sincronizar). */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores configuram o sync");
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  await assertAccount(user, accountId); // outro grupo = 404
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });
  try {
    const contas = await btgListarContas(account.companyId, apenasDigitos(account.company.cnpj));
    return Response.json(contas.map((c) => ({ accountId: c.accountId, agencia: c.branchCode ?? null, numero: c.number ?? null })));
  } catch (e) {
    if (e instanceof BtgNaoConfigurado) return Response.json({ error: e.message }, { status: 503 });
    if (e instanceof BtgSemConsentimento) return Response.json({ error: `BTG de "${account.company.name}" não conectado`, needsAuth: true }, { status: 401 });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
