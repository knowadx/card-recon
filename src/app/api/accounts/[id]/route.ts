import { prisma } from "@/lib/db";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const account = await prisma.account.update({
    where: { id },
    data: {
      companyId: body.companyId,
      bank: body.bank,
      currency: body.currency,
      name: body.name,
      ...(body.apiToken !== undefined ? { apiToken: body.apiToken || null } : {}),
      ...(body.operationId !== undefined ? { operationId: body.operationId || null } : {}),
    },
    include: { company: true },
  });
  return Response.json(account);
}

/** PATCH /api/accounts/[id] — merge parcial em syncConfig (ex.: { wiseProfileId } ou { mercuryAccountId }). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const acc = await prisma.account.findUnique({ where: { id }, select: { syncConfig: true } });
  if (!acc) return Response.json({ error: "account not found" }, { status: 404 });
  let config: Record<string, unknown> = {};
  try { config = acc.syncConfig ? JSON.parse(acc.syncConfig) : {}; } catch { config = {}; }
  const merged = { ...config, ...(body.syncConfig ?? {}) };
  await prisma.account.update({ where: { id }, data: { syncConfig: JSON.stringify(merged) } });
  return Response.json({ ok: true, syncConfig: merged });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.account.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
