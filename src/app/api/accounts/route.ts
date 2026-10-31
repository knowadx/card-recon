import { prisma } from "@/lib/db";
import { AccessError, accountScope, assertCompany, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";

export const GET = guarded(async () => {
  const user = await requireUser();
  const accounts = await prisma.account.findMany({
    where: await accountScope(user),
    include: { company: true },
    orderBy: { name: "asc" },
  });
  // Não vaza o token pro client — só sinaliza se existe
  return Response.json(
    accounts.map(({ apiToken, ...a }) => ({ ...a, hasApiToken: !!apiToken })),
  );
});

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json();
  await assertCompany(user, body.companyId);
  if (body.apiToken && !isManager(user.role)) {
    throw new AccessError(403, "só administradores cadastram o token do banco");
  }
  const { apiToken, ...account } = await prisma.account.create({
    data: {
      companyId: body.companyId,
      bank: body.bank,
      currency: body.currency,
      name: body.name,
      apiToken: body.apiToken || null,
    },
    include: { company: true },
  });
  return Response.json({ ...account, hasApiToken: !!apiToken }, { status: 201 });
});
