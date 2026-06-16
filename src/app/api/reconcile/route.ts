import { NextResponse } from "next/server";
import { reconcile } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

/** GET /api/reconcile?period=YYYY-MM */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await reconcile(url.searchParams.get("period"));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
