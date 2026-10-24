import { syncBtgAccount } from "@/lib/sync/btg";
import { guarded, requireUser } from "@/lib/access";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/sync/btg { accountId, btgAccountId?, from? } — sync de UMA conta BTG (lembra a conta escolhida). */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const { accountId, btgAccountId, from } = (await request.json().catch(() => ({}))) as { accountId?: string; btgAccountId?: string; from?: string };
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });
  // escopo (outro grupo = 404) e token da própria empresa acontecem dentro do sync (src/lib/sync/btg.ts)
  const { status, body } = await syncBtgAccount({ user, accountId, btgAccountId, from, saveSyncConfig: true });
  if (status === 200) await recomputeHasReceipt();
  return Response.json(body, { status });
});
