import { prisma } from "@/lib/db";

interface WiseProfile {
  id: number;
  type?: string;
  fullName?: string;
  details?: { name?: string; firstName?: string; lastName?: string; businessName?: string };
}

/** GET /api/sync/wise/profiles?accountId= — lista profiles usando o token DA CONTA. */
export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");

  let key: string | null = null;
  if (accountId) {
    const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { apiToken: true } });
    key = acc?.apiToken ?? null;
  }
  key = key ?? process.env.WISE_API_KEY ?? null;
  if (!key) return Response.json({ error: "Token Wise não cadastrado nesta conta" }, { status: 400 });

  const res = await fetch("https://api.wise.com/v2/profiles", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return Response.json({ error: `Wise error ${res.status}` }, { status: 500 });
  const profiles: WiseProfile[] = await res.json();

  // rótulo legível por empresa (business name / nome)
  return Response.json(
    profiles.map((p) => ({
      id: String(p.id),
      type: p.type,
      label:
        p.details?.businessName ||
        p.details?.name ||
        p.fullName ||
        [p.details?.firstName, p.details?.lastName].filter(Boolean).join(" ") ||
        `${p.type ?? "profile"} ${p.id}`,
    })),
  );
}
