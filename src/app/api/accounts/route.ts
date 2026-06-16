import { prisma } from "@/lib/db";

export async function GET() {
  const accounts = await prisma.account.findMany({
    include: { company: true },
    orderBy: { name: "asc" },
  });
  return Response.json(accounts);
}

export async function POST(request: Request) {
  const body = await request.json();
  const account = await prisma.account.create({
    data: { companyId: body.companyId, bank: body.bank, currency: body.currency, name: body.name },
    include: { company: true },
  });
  return Response.json(account, { status: 201 });
}
