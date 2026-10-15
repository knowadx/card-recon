import { prisma } from "@/lib/db";
import { assertAccount, assertCompany, assertOperation, guarded, requireUser } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertAccount(user, id);
  const body = await request.json();
  if (body.companyId) await assertCompany(user, body.companyId); // mover para outra empresa: só se ela for sua
  if (body.operationId) await assertOperation(user, body.operationId);
  const { apiToken, ...account } = await prisma.account.update({
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
  // Não vaza o token pro client — só sinaliza se existe
  return Response.json({ ...account, hasApiToken: !!apiToken });
});

/** PATCH /api/accounts/[id] — merge parcial em syncConfig (ex.: { wiseProfileId } ou { mercuryAccountId }). */
export const PATCH = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertAccount(user, id);
  const body = await request.json().catch(() => ({}));
  const acc = await prisma.account.findUnique({ where: { id }, select: { syncConfig: true } });
  if (!acc) return Response.json({ error: "account not found" }, { status: 404 });
  let config: Record<string, unknown> = {};
  try { config = acc.syncConfig ? JSON.parse(acc.syncConfig) : {}; } catch { config = {}; }
  const merged = { ...config, ...(body.syncConfig ?? {}) };
  await prisma.account.update({ where: { id }, data: { syncConfig: JSON.stringify(merged) } });
  return Response.json({ ok: true, syncConfig: merged });
});

export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertAccount(user, id);
  await prisma.account.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
