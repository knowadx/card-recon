import { prisma } from "@/lib/db";
import { assertAccount, guarded, requireSuperadmin, requireUser } from "@/lib/access";
import { wiseProfileLabel, type WiseProfile } from "@/lib/sync/wise";


/** GET /api/sync/wise/accounts?accountId= — lista profiles BUSINESS usando o token DA CONTA. */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const accountId = new URL(request.url).searchParams.get("accountId");

  let key: string | null = null;
  if (accountId) {
    await assertAccount(user, accountId); // conta de outro grupo = 404
    const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { apiToken: true } });
    key = acc?.apiToken ?? null;
  }
  // sem token da própria conta → chave global (WISE_API_KEY, não é de conta nenhuma): só o administrador geral
  if (!key) await requireSuperadmin();
  key = key ?? process.env.WISE_API_KEY ?? null;
  if (!key) return Response.json({ error: "Token Wise não cadastrado nesta conta" }, { status: 400 });

  const res = await fetch("https://api.wise.com/v2/profiles", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return Response.json({ error: `Wise error ${res.status}` }, { status: 500 });

  const profiles: WiseProfile[] = await res.json();
  const business = profiles
    .filter((p) => p.type === "BUSINESS")
    .map((p) => ({
      id: String(p.id),
      label: wiseProfileLabel(p),
    }));

  return Response.json(business);
});
