import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.cardWhitelist.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows);
}

/** POST { last4, label?, company? } — marca um cartão como legítimo. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const { last4, label, company } = await request.json().catch(() => ({}));
  const clean = String(last4 ?? "").match(/\d{4}/)?.[0];
  if (!clean) return NextResponse.json({ ok: false, error: "last4 inválido" }, { status: 400 });
  await prisma.cardWhitelist.upsert({
    where: { last4_company: { last4: clean, company: company ?? "" } },
    update: { label: label ?? null, addedBy: user?.email ?? null },
    create: { last4: clean, label: label ?? null, company: company ?? "", addedBy: user?.email ?? null },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id ausente" }, { status: 400 });
  await prisma.cardWhitelist.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
