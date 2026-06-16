import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || u.role !== "admin") return null;
  return u;
}

export async function GET() {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { memberships: { include: { company: true } } },
  });
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      companies: u.memberships.map((m) => ({ id: m.companyId, name: m.company.name })),
    })),
  );
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { email, password, name, role, companyIds } = await request.json().catch(() => ({}));
  if (!email || !password) return Response.json({ error: "email e senha obrigatórios" }, { status: 400 });
  try {
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash: hashPassword(String(password)),
        name: name ?? null,
        role: role === "admin" ? "admin" : "member",
        memberships: Array.isArray(companyIds)
          ? { create: companyIds.map((companyId: string) => ({ companyId })) }
          : undefined,
      },
    });
    return NextResponse.json({ ok: true, id: user.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
