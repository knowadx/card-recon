import { syncRevolutAccount } from "@/lib/sync/revolut";
import { guarded, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const { accountId, revolutAccountId, from } = body as {
    accountId: string;
    revolutAccountId?: string;
    from?: string;
  };

  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  // assertAccount (outro grupo = 404) + token OAuth da própria empresa acontecem dentro do sync (src/lib/sync/revolut.ts)
  const { status, body: result } = await syncRevolutAccount({ user, accountId, revolutAccountId, from, saveSyncConfig: true });
  return Response.json(result, { status });
});
