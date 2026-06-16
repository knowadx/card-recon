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
    },
    include: { company: true },
  });
  return Response.json(account);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.account.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
