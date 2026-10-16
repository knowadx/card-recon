import { NextResponse } from "next/server";
import { guarded, requireSuperadmin, requireUser } from "@/lib/access";
import { getSyncPeriod, setSyncPeriod } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET → período de sync atual { from, to }. Qualquer usuário logado lê. */
export const GET = guarded(async () => {
  await requireUser();
  return NextResponse.json(await getSyncPeriod());
});

/** POST { from, to } → salva o período. Vale pra TODOS os syncs e o piso da Checagem → configuração global: só o administrador geral. */
export const POST = guarded(async (request: Request) => {
  await requireSuperadmin();
  const { from, to } = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "from inválido (use YYYY-MM-DD)" }, { status: 400 });
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "to inválido (use YYYY-MM-DD)" }, { status: 400 });
  }
  await setSyncPeriod(from, to || null);
  return NextResponse.json(await getSyncPeriod());
});
