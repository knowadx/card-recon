import { NextResponse } from "next/server";
import { guarded, requireSuperadmin } from "@/lib/access";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/** GET/POST /api/admin/recompute-receipts — recalcula "Possui Fatura" em todas as transações. */
const run = guarded(async () => {
  await requireSuperadmin();
  return NextResponse.json(await recomputeHasReceipt());
});
export const GET = run;
export const POST = run;
