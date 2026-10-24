import { prisma } from "@/lib/db";
import { apenasDigitos, btgGet, btgListarContas, BtgNaoConfigurado, BtgSemConsentimento } from "@/lib/btg";
import { isMetaMerchant, extractMetaRef } from "@/lib/metaCheck";
import { getSyncPeriod } from "@/lib/settings";
import { assertAccount, type AppUser } from "@/lib/access";
import { markSynced, type SyncOutcome } from "./common";

/** Movimento do extrato (GET /{CNPJ}/banking/accounts/{accountId}/statements — doc oficial do BTG). */
type BtgMovimento = {
  id?: number | string;
  txId?: string;
  type?: string; // "debit" | "credit"
  category?: { name?: string; description?: string };
  description?: string;
  descriptionDetails?: string;
  dateHour?: string;
  amount?: number;
};
type BtgExtrato = {
  _links?: { next?: string | null };
  data?: { dailyMovements?: Array<{ date?: string; movements?: BtgMovimento[] }> };
};

export type BtgSyncBody =
  | { imported: number; fetched: number; skipped: number; incompleto?: true }
  | { error: string; needsAuth?: true; contas?: Array<{ accountId: string; numero: string | null }> };

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Janelas de até 31 dias de `de` até `ate` (a API exige startDate e endDate). */
function janelas(de: Date, ate: Date): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let ini = new Date(de); ini <= ate; ) {
    const fim = new Date(ini);
    fim.setUTCDate(fim.getUTCDate() + 30);
    out.push([dia(ini), dia(fim < ate ? fim : ate)]);
    ini = new Date(fim);
    ini.setUTCDate(ini.getUTCDate() + 1);
  }
  return out;
}

/**
 * Sync de UMA conta BTG — a ÚNICA implementação (rota /api/sync/btg e /api/sync/all).
 *  - conta fora do escopo: AccessError (404); empresa sem CNPJ: 400; BTG não conectado: 401 needsAuth;
 *  - btgAccountId: o escolhido (ou o salvo); sem escolha e a empresa com UMA conta no BTG = essa;
 *  - extrato type=simple (sem rendimentos), em janelas de 31 dias, seguindo `_links.next`;
 *  - uma linha por movimento: reference btg:<conta>:<id>; débito negativo; cobrança Meta pela mesma regra
 *    dos outros bancos (isMetaMerchant/extractMetaRef);
 *  - só marca "sincronizada até hoje" se leu todas as janelas.
 */
export async function syncBtgAccount(opts: {
  user: AppUser;
  accountId: string;
  btgAccountId?: string | null;
  from?: string | null;
  saveSyncConfig: boolean;
}): Promise<SyncOutcome<BtgSyncBody>> {
  const { user, accountId, from } = opts;
  await assertAccount(user, accountId);
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: true } });
  if (!account) return { status: 404, body: { error: "account not found" } };
  const cnpj = apenasDigitos(account.company.cnpj);
  if (cnpj.length !== 14) return { status: 400, body: { error: `a empresa "${account.company.name}" não tem CNPJ cadastrado` } };

  let btgAccountId = opts.btgAccountId || null;
  try {
    if (!btgAccountId) {
      const contas = await btgListarContas(account.companyId, cnpj);
      if (contas.length !== 1) {
        return { status: 400, body: { error: contas.length ? "a empresa tem mais de uma conta no BTG — escolha qual" : "nenhuma conta desta empresa no BTG", contas: contas.map((c) => ({ accountId: c.accountId, numero: c.number ?? null })) } };
      }
      btgAccountId = contas[0].accountId;
    }
  } catch (e) {
    if (e instanceof BtgNaoConfigurado) return { status: 503, body: { error: e.message } };
    if (e instanceof BtgSemConsentimento) return { status: 401, body: { error: `BTG da empresa "${account.company.name}" não conectado`, needsAuth: true } };
    return { status: 502, body: { error: (e as Error).message } };
  }

  if (opts.saveSyncConfig) {
    await prisma.account.update({ where: { id: accountId }, data: { syncConfig: JSON.stringify({ btgAccountId }) } });
  }

  const period = await getSyncPeriod();
  const de = new Date(`${from || period.from}T00:00:00.000Z`);
  const hoje = new Date();
  const existentes = new Set(
    (await prisma.transaction.findMany({ where: { accountId, reference: { startsWith: "btg:" } }, select: { reference: true } })).map((t) => t.reference),
  );

  let imported = 0, fetched = 0, completo = true;
  try {
    for (const [ini, fim] of janelas(de, hoje)) {
      let proxima: string | null = `/${cnpj}/banking/accounts/${encodeURIComponent(btgAccountId)}/statements?startDate=${ini}&endDate=${fim}&type=simple&pageSize=1000`;
      for (let pagina = 0; proxima && pagina < 50; pagina++) {
        const res = await btgGet(account.companyId, proxima);
        if (!res.ok) return { status: 502, body: { error: `BTG extrato ${res.status}: ${(await res.text()).slice(0, 300)}` } };
        const j = (await res.json()) as BtgExtrato;
        const novos = [];
        for (const d of j.data?.dailyMovements ?? []) {
          for (const m of d.movements ?? []) {
            fetched++;
            const id = m.id ?? m.txId;
            if (id == null || typeof m.amount !== "number") continue;
            const reference = `btg:${btgAccountId}:${id}`;
            if (existentes.has(reference)) continue;
            existentes.add(reference);
            const descricao = [m.description, m.descriptionDetails].filter(Boolean).join(" — ") || m.category?.description || "BTG";
            novos.push({
              accountId,
              reference,
              date: new Date(m.dateHour ?? d.date ?? `${ini}T00:00:00Z`),
              description: descricao,
              amount: m.type === "debit" ? -Math.abs(m.amount) : Math.abs(m.amount),
              fee: 0,
              currency: account.currency,
              isMetaCharge: isMetaMerchant(m.description, m.descriptionDetails),
              metaRef: extractMetaRef(m.description, m.descriptionDetails),
              operationId: account.operationId,
            });
          }
        }
        if (novos.length) {
          await prisma.transaction.createMany({ data: novos });
          imported += novos.length;
        }
        proxima = j._links?.next || null;
      }
      if (proxima) completo = false; // parou no teto de páginas: esta janela não foi lida inteira
    }
  } catch (e) {
    if (e instanceof BtgSemConsentimento) return { status: 401, body: { error: `BTG da empresa "${account.company.name}" não conectado`, needsAuth: true } };
    return { status: 502, body: { error: (e as Error).message } };
  }

  if (completo) await markSynced(accountId, hoje);
  return { status: 200, body: { imported, fetched, skipped: Math.max(0, fetched - imported), ...(completo ? {} : { incompleto: true as const }) } };
}
