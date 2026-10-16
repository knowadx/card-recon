import { prisma } from "@/lib/db";
import { AccessError, assertAccount, assertCompany, assertOperation, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";

/** Ligar a conta ao banco (token e ids da conta no banco) é configuração de integração: só superadmin e admins. */
function requireBankLinkRights(role: string) {
  if (!isManager(role)) throw new AccessError(403, "só administradores ligam a conta ao banco (token e conta no banco)");
}

type Ctx = { params: Promise<{ id: string }> };

export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertAccount(user, id);
  const body = await request.json();
  if (body.companyId) await assertCompany(user, body.companyId); // mover para outra empresa: só se ela for sua
  if (body.operationId) await assertOperation(user, body.operationId);
  if (body.apiToken !== undefined) requireBankLinkRights(user.role);
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
  requireBankLinkRights(user.role); // syncConfig = ids da conta no banco (Mercury/Wise/Revolut)
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
