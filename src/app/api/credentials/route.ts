import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — lista credenciais (token mascarado). */
export async function GET() {
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

/** POST — cria/atualiza credencial (mercury/wise). { issuer, company, token, secrets? } */
export async function POST(request: Request) {
  try {
    const { issuer, company, token, secrets } = await request.json();
    if (!issuer || !company) {
      return NextResponse.json({ ok: false, error: "issuer e company são obrigatórios" }, { status: 400 });
    }
    await prisma.credential.upsert({
      where: { issuer_company: { issuer, company } },
      update: { token: token ?? "", secrets: secrets ? JSON.stringify(secrets) : undefined, isActive: true },
      create: { issuer, company, token: token ?? "", secrets: secrets ? JSON.stringify(secrets) : null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE /api/credentials?id= */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id ausente" }, { status: 400 });
  await prisma.credential.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
