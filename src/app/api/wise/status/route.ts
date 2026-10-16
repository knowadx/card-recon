import { prisma } from "@/lib/db";
import { getValidWiseToken } from "@/lib/wise";
import { guarded, requireSuperadmin } from "@/lib/access";

export const GET = guarded(async () => {
  await requireSuperadmin(); // estado das integrações = só o administrador geral
  try {
    await getValidWiseToken(prisma);
    return Response.json({ connected: true });
  } catch {
    return Response.json({ connected: false });
  }
});
