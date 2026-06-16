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
    include: { memberships: { include: { holding: true } } },
  });
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      holdings: u.memberships.map((m) => ({ id: m.holdingId, name: m.holding.name })),
    })),
  );
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { email, password, name, role, holdingIds } = await request.json().catch(() => ({}));
  if (!email || !password) return Response.json({ error: "email e senha obrigatórios" }, { status: 400 });
  try {
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash: hashPassword(String(password)),
        name: name ?? null,
        role: role === "admin" ? "admin" : "member",
        memberships: Array.isArray(holdingIds)
          ? { create: holdingIds.map((holdingId: string) => ({ holdingId })) }
          : undefined,
      },
    });
    return NextResponse.json({ ok: true, id: user.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
