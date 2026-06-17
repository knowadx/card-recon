import { NextResponse } from "next/server";
import { completeConsent } from "@/lib/revolut";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(`<html><body style="font-family:sans-serif;padding:40px">${body}</body></html>`, {
    headers: { "Content-Type": "text/html" },
    status,
  });

/** GET /api/revolut/callback?code=...&state=<company> — guarda os tokens da empresa. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const company = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return html(`<h2>Autorização negada</h2><p>${error}</p>`, 400);
  if (!code || !company) return html("<h2>code/state ausentes</h2>", 400);
  try {
    await completeConsent(company, code);
    return html(`<h2 style="color:#00b9a5">✓ Revolut conectado (${company})!</h2><p>Pode fechar esta aba.</p>`);
  } catch (e) {
    return html(`<h2>Erro ao conectar</h2><p>${(e as Error).message}</p>`, 500);
  }
}
