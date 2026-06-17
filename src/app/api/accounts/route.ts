import { prisma } from "@/lib/db";
import { scopedAccountIds } from "@/lib/auth";

export async function GET() {
  const scope = await scopedAccountIds();
  const accounts = await prisma.account.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    include: { company: true, operation: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  // Não vaza o token pro client — só sinaliza se existe
  return Response.json(
    accounts.map(({ apiToken, ...a }) => ({ ...a, hasApiToken: !!apiToken })),
  );
}

export async function POST(request: Request) {
  const body = await request.json();
  const account = await prisma.account.create({
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
  return Response.json(account, { status: 201 });
}
