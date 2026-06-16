import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";

export async function GET() {
  try {
    const scope = await scopedCompanyIds();
    const companies = await prisma.company.findMany({
      where: scope === "all" ? {} : { id: { in: scope } },
      orderBy: { name: "asc" },
    });
    return Response.json(companies);
  } catch (e) {
    console.error(e);
    console.error(e); return Response.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const company = await prisma.company.create({
    data: { name: body.name, cnpj: body.cnpj || null, color: body.color || "#6366f1" },
  });
  return Response.json(company, { status: 201 });
}
