import { prisma } from "@/lib/db";
import { companyScope, guarded, requireUser } from "@/lib/access";
import { btgConfig, btgEmpresasConectadas } from "@/lib/btg";

export const dynamic = "force-dynamic";

/** GET /api/btg/status — o BTG está configurado no servidor? Quais empresas (do escopo do usuário) estão conectadas. */
export const GET = guarded(async () => {
  const user = await requireUser();
  const cfg = btgConfig();
  const conectadas = await btgEmpresasConectadas();
  const visiveis = await prisma.company.findMany({ where: { AND: [{ id: { in: conectadas } }, await companyScope(user)] }, select: { id: true } });
  return Response.json({ configurado: !!cfg, ambiente: cfg?.ambiente ?? null, empresas: visiveis.map((c) => c.id) });
});
