import { prisma } from "@/lib/db";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export async function GET() {
  try {
    const accessToken = await getValidAccessToken(prisma);
    const res = await fetch(`${REVOLUT_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `Revolut API ${res.status}: ${err}` }, { status: 502 });
    }
    const accounts = await res.json();
    return Response.json(accounts);
  } catch (e) {
    console.error(e); return Response.json({ error: "Erro de autenticação Revolut", needsAuth: true }, { status: 401 });
  }
}
