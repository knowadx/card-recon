import { syncWiseAccount } from "@/lib/sync/wise";
import { AccessError, guarded, requireUser } from "@/lib/access";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  try {
    const body = await request.json();
    const { profileId, accountId, from, to } = body as {
      profileId: string;
      accountId: string;
      from?: string;
      to?: string;
    };

    if (!profileId || !accountId) {
      return Response.json({ error: "profileId and accountId required" }, { status: 400 });
    }

    // assertAccount (outro grupo = 404) + token por resolveBankToken acontecem dentro do sync (src/lib/sync/wise.ts)
    const { status, body: result } = await syncWiseAccount({ user, accountId, profileId, from, to, saveSyncConfig: true });
    // transação nova cuja fatura (PDF) já está no sistema já sai "com fatura" — a ordem dos passos deixa de importar
    if (status === 200) await recomputeHasReceipt();
    return Response.json(result, { status });
  } catch (e) {
    if (e instanceof AccessError) throw e; // permissão: guarded responde 404 (não vira 500)
    console.error("Wise sync error:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
