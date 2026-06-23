import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/recover?secret=...&email=...&password=...
 * Redefine a senha de um usuário quando o dono perdeu o acesso e não consegue logar.
 * Gate = RECOVERY_SECRET (se definida) OU o segredo de sessão (SESSION_SECRET/APP_PASSWORD),
 * que já está no ambiente — assim não precisa criar env nem redeploy. Endpoint deve ser
 * removido depois do uso.
 */
export async function GET(request: Request) {
  // Dormente por padrão: só funciona se RECOVERY_SECRET estiver definida no ambiente.
  const gate = process.env.RECOVERY_SECRET;
  if (!gate) return NextResponse.json({ error: "recovery disabled" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const secret = params.get("secret") ?? "";
  const a = Buffer.from(secret);
  const b = Buffer.from(gate);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const email = (params.get("email") ?? "").trim().toLowerCase();
  const password = params.get("password") ?? "";
  if (!email || password.length < 6) {
    return NextResponse.json({ error: "email e password (mín. 6 caracteres) obrigatórios" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "usuário não encontrado" }, { status: 404 });

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });
  return NextResponse.json({ ok: true, email, message: "Senha redefinida — já pode logar." });
}
