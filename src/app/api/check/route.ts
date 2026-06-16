import { NextResponse } from "next/server";
import { runMetaCheck } from "@/lib/check";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/check — roda a checagem anti-vazamento sobre as transações. */
export async function POST() {
  try {
    const result = await runMetaCheck();
    return NextResponse.json({ ok: true, summary: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
