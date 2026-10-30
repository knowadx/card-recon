import { prisma } from "@/lib/db";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";

/** GET /api/revolut/accounts?accountId= — lista contas Revolut da EMPRESA daquela conta. */
export const GET = guarded(async (request: Request) => {
  await requireSuperadmin(); // integração Revolut (lista dados crus do banco) = só o administrador geral
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });

  try {
    const accessToken = await getValidAccessToken(account.companyId);
    const res = await fetch(`${REVOLUT_BASE}/accounts`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return Response.json({ error: `Revolut API ${res.status}: ${await res.text()}` }, { status: 502 });
    return Response.json(await res.json());
  } catch (e) {
    return Response.json({ error: `Revolut "${account.company.name}" não conectado`, needsAuth: true, detail: (e as Error).message }, { status: 401 });
  }
});
