import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — saúde do app e do banco, para o deploy e o healthcheck do Docker.
 * Pública na porta de entrada (proxy.ts) e não devolve NENHUM dado: só ok/erro.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
