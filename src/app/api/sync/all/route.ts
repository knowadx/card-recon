import { prisma } from "@/lib/db";
import { getSyncPeriod } from "@/lib/settings";
import { accountScope, assertCompany, guarded, requireUser, type AppUser } from "@/lib/access";
import { mapLimit, type SyncOutcome } from "@/lib/sync/common";
import { syncMercuryAccount } from "@/lib/sync/mercury";
import { syncWiseAccount } from "@/lib/sync/wise";
import { syncRevolutAccount } from "@/lib/sync/revolut";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** syncConfig salvo na conta (PATCH /api/accounts/[id] e as rotas por banco). */
type SyncConfig = { mercuryAccountId?: string; mercuryEntity?: string; wiseProfileId?: string; revolutAccountId?: string | null };

type Bank = "mercury" | "wise" | "revolut";

type AccountResult = { bank: Bank | null; imported: number; skipped: number; error?: string } & Record<string, unknown>;

/** Corpo da rota do banco → linha da conta no sync/all (imported/skipped somáveis; erro, se houver). */
function summarize(bank: Bank, { body }: SyncOutcome<object>): AccountResult {
  const b = body as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return { bank, ...b, imported: num(b.imported), skipped: num(b.skipped ?? b.alreadyExisted) };
}

function parseConfig(raw: string): SyncConfig | null {
  try {
    const c = JSON.parse(raw);
    return c && typeof c === "object" ? (c as SyncConfig) : null;
  } catch {
    return null;
  }
}

/** Qual banco a conta sincroniza, pelo syncConfig salvo (mesma prioridade de sempre: Mercury, Wise, Revolut). */
function bankOf(config: SyncConfig | null): Bank | null {
  if (config?.mercuryAccountId) return "mercury";
  if (config?.wiseProfileId) return "wise";
  if (config && "revolutAccountId" in config) return "revolut";
  return null;
}

/**
 * Uma conta: lê o syncConfig salvo e chama a MESMA implementação da rota do banco (src/lib/sync/*),
 * com o mesmo escopo (assertAccount) e as mesmas regras de token. Só LÊ o syncConfig.
 * Erro de UMA conta (API do banco, permissão, banco de dados) vira erro dela e não derruba as outras.
 */
async function syncAccount(user: AppUser, account: { id: string; syncConfig: string | null }, from: string): Promise<AccountResult> {
  const config = parseConfig(account.syncConfig ?? "");
  const bank = bankOf(config);
  if (!config || !bank) return { bank: null, imported: 0, skipped: 0, error: "Config inválida" };
  try {
    switch (bank) {
      case "mercury":
        return summarize(bank, await syncMercuryAccount({
          user, accountId: account.id, mercuryAccountId: config.mercuryAccountId!, entity: config.mercuryEntity, from, saveSyncConfig: false,
        }));
      case "wise":
        return summarize(bank, await syncWiseAccount({ user, accountId: account.id, profileId: config.wiseProfileId!, from, saveSyncConfig: false }));
      case "revolut":
        return summarize(bank, await syncRevolutAccount({ user, accountId: account.id, revolutAccountId: config.revolutAccountId, from, saveSyncConfig: false }));
    }
  } catch (e) {
    return { bank, imported: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const period = await getSyncPeriod();
  const from: string = body.from || period.from;
  const company: string | undefined = body.company || undefined; // escopo de empresa (companyId)
  if (company) await assertCompany(user, company); // empresa de outro grupo = 404

  // só as contas do escopo do usuário (superadmin = todas)
  const accounts = await prisma.account.findMany({
    where: { AND: [{ syncConfig: { not: null }, ...(company ? { companyId: company } : {}) }, await accountScope(user)] },
    select: { id: true, name: true, syncConfig: true },
  });

  if (accounts.length === 0) {
    return Response.json({ error: "Nenhuma conta com sync configurado. Faça um sync manual primeiro." }, { status: 400 });
  }

  // concorrência limitada (3) p/ não martelar os limites de taxa dos bancos (ex.: Revolut 429)
  const results = await mapLimit(accounts, 3, async (account) => ({
    accountId: account.id,
    accountName: account.name,
    ...(await syncAccount(user, account, from)),
  }));

  const totalImported = results.reduce((s, r) => s + r.imported, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);

  return Response.json({ imported: totalImported, skipped: totalSkipped, accounts: results });
});
