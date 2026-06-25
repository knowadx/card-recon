import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/** GET/POST /api/admin/recompute-receipts — recalcula "Possui Fatura" em todas as transações. */
async function run() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await recomputeHasReceipt());
}
export const GET = run;
export const POST = run;
