import { NextResponse } from "next/server";
import { runChargeMatch } from "@/lib/chargeMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/check — re-roda o matching extrato × cobranças Meta (sem re-puxar da API). */
export async function POST() {
  try {
    const result = await runChargeMatch();
    return NextResponse.json({ ok: true, summary: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
