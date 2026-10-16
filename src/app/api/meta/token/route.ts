import { NextResponse } from "next/server";
import { getCurrentUser, findAccessibleOperation } from "@/lib/auth";
import { conferirTokenColado, salvarConexaoMeta } from "@/lib/metaConexao";

export const dynamic = "force-dynamic";

/**
 * POST /api/meta/token { operationId, token } — conecta a Meta da operação com um token colado
 * (usuário do sistema do Gerenciador de Negócios), sem a tela de login do Facebook.
 * Mesmo acesso do "Conectar Meta": o operador da operação ou um admin dela.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { operationId?: string; token?: string };
  if (!body.operationId) return NextResponse.json({ ok: false, error: "operationId obrigatório" }, { status: 400 });
  if (!process.env.META_APP_ID) return NextResponse.json({ ok: false, error: "META_APP_ID não configurado" }, { status: 500 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });
  const op = await findAccessibleOperation(user, body.operationId);
  if (!op) return NextResponse.json({ ok: false, error: "sem acesso a essa operação" }, { status: 403 });

  const token = String(body.token ?? "").trim();
  const conferido = await conferirTokenColado(token);
  if (!conferido.ok) return NextResponse.json({ ok: false, error: conferido.erro }, { status: conferido.status });

  const { perfil } = await salvarConexaoMeta(op, token, { tipo: conferido.tipo, via: "token" });
  return NextResponse.json({ ok: true, operacao: op.name, perfil, tipo: conferido.tipo, expiraEm: conferido.expiraEm });
}
