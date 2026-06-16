import { prisma } from "@/lib/db";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const company = await prisma.company.update({
    where: { id },
    data: { name: body.name, cnpj: body.cnpj || null, color: body.color },
  });
  return Response.json(company);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.company.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
