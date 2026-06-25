import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSyncPeriod, setSyncPeriod } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET → período de sync atual { from, to }. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await getSyncPeriod());
}

/** POST { from, to } → salva o período. Vale pra TODOS os syncs e o piso da Checagem. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { from, to } = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "from inválido (use YYYY-MM-DD)" }, { status: 400 });
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "to inválido (use YYYY-MM-DD)" }, { status: 400 });
  }
  await setSyncPeriod(from, to || null);
  return NextResponse.json(await getSyncPeriod());
}
