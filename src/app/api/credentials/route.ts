import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const u = await getCurrentUser();
  return u && u.role === "superadmin" ? u : null;
}

/** GET — lista credenciais (token mascarado). */
export async function GET() {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.credential.findMany({ orderBy: [{ issuer: "asc" }, { company: "asc" }] });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      issuer: r.issuer,
      company: r.company,
      isActive: r.isActive,
      tokenMasked: r.token ? `${r.token.slice(0, 4)}…${r.token.slice(-4)}` : "(vazio)",
      hasToken: !!r.token,
    })),
  );
}

/** POST — cria/atualiza credencial { issuer, company, token }. */
export async function POST(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { issuer, company, token } = await request.json().catch(() => ({}));
  if (!issuer || !company || !token) {
    return NextResponse.json({ ok: false, error: "issuer, company e token são obrigatórios" }, { status: 400 });
  }
  await prisma.credential.upsert({
    where: { issuer_company: { issuer, company } },
    update: { token, isActive: true },
    create: { issuer, company, token },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id ausente" }, { status: 400 });
  await prisma.credential.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
