import { connectedRevolutCompanies } from "@/lib/revolut";

/** GET /api/revolut/status — empresas Revolut já conectadas (consentidas). */
export async function GET() {
  const companies = await connectedRevolutCompanies();
  return Response.json({ connected: companies.length > 0, companies });
}
