import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** POST /api/sync/all?period=YYYY-MM — roda os provedores já implementados. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "";
  const origin = url.origin;
  const providers = ["meta", "mercury", "wise", "revolut"];
  const results: Record<string, unknown> = {};

  for (const p of providers) {
    try {
      const res = await fetch(`${origin}/api/sync/${p}?period=${period}`, { method: "POST" });
      results[p] = await res.json();
    } catch (e) {
      results[p] = { ok: false, error: (e as Error).message };
    }
  }

  return NextResponse.json({ ok: true, period, results });
}
