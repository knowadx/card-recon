import { prisma } from "@/lib/db";
import { accountScope, assertCompany, assertOperation, guarded, requireUser } from "@/lib/access";

export const GET = guarded(async () => {
  const user = await requireUser();
  const accounts = await prisma.account.findMany({
    where: await accountScope(user),
    include: { company: true, operation: { select: { id: true, name: true } } },
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
  if (body.operationId) await assertOperation(user, body.operationId);
  const { apiToken, ...account } = await prisma.account.create({
    data: {
      companyId: body.companyId,
      bank: body.bank,
      currency: body.currency,
      name: body.name,
      apiToken: body.apiToken || null,
      operationId: body.operationId || null,
    },
    include: { company: true },
  });
  return Response.json({ ...account, hasApiToken: !!apiToken }, { status: 201 });
});
