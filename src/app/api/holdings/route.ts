import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, accessibleHoldingIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  const scope = await accessibleHoldingIds(user.id, user.role);
  const holdings = await prisma.holding.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    include: { companies: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(holdings);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") return Response.json({ error: "forbidden" }, { status: 403 });
  const { name, color } = await request.json().catch(() => ({}));
  if (!name) return Response.json({ error: "name obrigatório" }, { status: 400 });
  const h = await prisma.holding.create({ data: { name, color: color || "#6366f1" } });
  return NextResponse.json(h, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });
  // desvincula empresas antes de remover
  await prisma.company.updateMany({ where: { holdingId: id }, data: { holdingId: null } });
  await prisma.holding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
