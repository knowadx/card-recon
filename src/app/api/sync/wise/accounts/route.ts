import { prisma } from "@/lib/db";
import { assertAccount, guarded, requireSuperadmin, requireUser } from "@/lib/access";

interface WiseProfile {
  id: number;
  type: string;
  fullName?: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  details?: { name?: string; businessName?: string; firstName?: string; lastName?: string };
}

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
      label:
        p.details?.businessName ||
        p.details?.name ||
        p.businessName ||
        p.fullName ||
        p.name ||
        [p.details?.firstName ?? p.firstName, p.details?.lastName ?? p.lastName].filter(Boolean).join(" ") ||
        `Business ${p.id}`,
    }));

  return Response.json(business);
});
