import { connectedRevolutCompanies } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";

/** GET /api/revolut/status — empresas Revolut já conectadas (consentidas). */
export const GET = guarded(async () => {
  await requireSuperadmin(); // estado das integrações = só o administrador geral
  const companies = await connectedRevolutCompanies();
  return Response.json({ connected: companies.length > 0, companies });
});
