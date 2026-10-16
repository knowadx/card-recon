import { syncMercuryAccount } from "@/lib/sync/mercury";
import { guarded, requireUser } from "@/lib/access";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json();
  const { mercuryAccountId, accountId, from, to, entity } = body as {
    mercuryAccountId: string;
    accountId: string;
    from?: string;
    to?: string;
    entity?: string;
  };

  if (!mercuryAccountId || !accountId) {
    return Response.json({ error: "mercuryAccountId and accountId required" }, { status: 400 });
  }

  // assertAccount (outro grupo = 404) + token por resolveBankToken acontecem dentro do sync (src/lib/sync/mercury.ts)
  const { status, body: result } = await syncMercuryAccount({ user, accountId, mercuryAccountId, entity, from, to, saveSyncConfig: true });
  // transação nova cuja fatura (PDF) já está no sistema já sai "com fatura" — a ordem dos passos deixa de importar
  if (status === 200) await recomputeHasReceipt();
  return Response.json(result, { status });
});
