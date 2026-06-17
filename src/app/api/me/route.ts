import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/me — usuário logado (id, email, role) p/ a UI adaptar permissões. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "unauth" }, { status: 401 });
  return NextResponse.json({ id: u.id, email: u.email, name: u.name, role: u.role });
}
