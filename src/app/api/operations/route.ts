import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, findMemberOperation, isSuperadmin, isManager, scopes } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Operação = etiqueta GLOBAL (como categoria): todo mundo logado vê a lista inteira pra marcar splits.
 * O que é de quem OPERA (o Meta conectado, o perfil) só sai pra membro/superadmin — `podeGerenciar`.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  const minhas = isSuperadmin(user.role) ? null : new Set((await scopes(user.id)).operationIds);
  const operations = await prisma.operation.findMany({
    include: { credentials: { where: { issuer: "meta" }, select: { id: true, isActive: true, updatedAt: true, secrets: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    operations.map(({ credentials, ...rest }) => {
      const podeGerenciar = !minhas || minhas.has(rest.id);
      if (!podeGerenciar) return { ...rest, podeGerenciar };
      const meta = credentials[0];
      let metaProfile: string | null = null;
      try { metaProfile = meta?.secrets ? (JSON.parse(meta.secrets).metaUserName ?? null) : null; } catch { /* ignore */ }
      return { ...rest, podeGerenciar, metaConnected: !!meta?.isActive, metaUpdatedAt: meta?.updatedAt ?? null, metaProfile };
    }),
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isManager(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { name, type } = await request.json().catch(() => ({}));
  if (!name) return Response.json({ error: "name obrigatório" }, { status: 400 });

  // admin que cria vira membro: sem holding dona, é isso que deixa ele conectar o Meta e dar acesso a ela
  const op = await prisma.operation.create({
    data: {
      name,
      type: type === "holding" ? "holding" : "own",
      ...(isSuperadmin(user.role) ? {} : { memberships: { create: { userId: user.id } } }),
    },
  });
  return NextResponse.json(op, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isManager(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  // apagar leva junto a conexão Meta e os acessos — só quem opera a operação (ou superadmin)
  if (!(await findMemberOperation(user, id))) return Response.json({ error: "sem acesso a essa operação" }, { status: 403 });
  await prisma.operation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
