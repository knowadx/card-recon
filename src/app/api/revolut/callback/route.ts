import { NextResponse } from "next/server";
import { completeConsent } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/** GET /api/revolut/callback?code=...&state=<company> — guarda os tokens da empresa. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const company = url.searchParams.get("state");
  if (!code || !company) {
    return NextResponse.json({ ok: false, error: "code/state ausentes no callback" }, { status: 400 });
  }
  try {
    await completeConsent(company, code);
    return NextResponse.redirect(new URL(`/?revolut=${encodeURIComponent(company)}`, url.origin));
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
