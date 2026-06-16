import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const u = await getCurrentUser();
  return u && u.role === "admin" ? u : null;
}

/** PATCH /api/users/[id] — { role?, isActive?, password?, companyIds? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (body.role) data.role = body.role === "admin" ? "admin" : "member";
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (body.password) data.passwordHash = hashPassword(String(body.password));
  if (Object.keys(data).length) await prisma.user.update({ where: { id }, data });

  if (Array.isArray(body.companyIds)) {
    await prisma.membership.deleteMany({ where: { userId: id } });
    if (body.companyIds.length) {
      await prisma.membership.createMany({
        data: body.companyIds.map((companyId: string) => ({ userId: id, companyId })),
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (id === admin.id) return Response.json({ error: "não pode remover a si mesmo" }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
