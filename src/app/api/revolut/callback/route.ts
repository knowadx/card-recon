import { prisma } from "@/lib/db";
import { exchangeCode } from "@/lib/revolut";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html" },
    status,
  });

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get("oauth_state_revolut")?.value;

  const stateValid = state && storedState && state.length === storedState.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(storedState));
  if (!stateValid) {
    return html("<h2>Erro de segurança</h2><p>State inválido. Tente novamente.</p>", 400);
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) return html(`<h2>Autorização negada</h2><p>Tente novamente.</p>`, 400);
  if (!code) return html("<h2>Código ausente</h2>", 400);

  try {
    const tokens = await exchangeCode(code);
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (tokens.expires_in ?? 1800);

    await Promise.all([
      prisma.setting.upsert({ where: { key: "revolut_access_token" }, create: { key: "revolut_access_token", value: tokens.access_token }, update: { value: tokens.access_token } }),
      prisma.setting.upsert({ where: { key: "revolut_refresh_token" }, create: { key: "revolut_refresh_token", value: tokens.refresh_token }, update: { value: tokens.refresh_token } }),
      prisma.setting.upsert({ where: { key: "revolut_access_token_exp" }, create: { key: "revolut_access_token_exp", value: String(exp) }, update: { value: String(exp) } }),
    ]);

    const res = html(`<h2 style="color:#00b9a5">✓ Revolut conectado!</h2><p>Pode fechar esta janela.</p><script>setTimeout(()=>window.close(),2000)</script>`);
    // Clear state cookie
    const nextRes = NextResponse.next();
    return new Response(res.body, {
      headers: { "Content-Type": "text/html", "Set-Cookie": "oauth_state_revolut=; Max-Age=0; Path=/" },
    });
  } catch {
    return html("<h2>Erro ao conectar</h2><p>Tente novamente.</p>", 500);
  }
}
