import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser, type AppUser } from "@/lib/access";
import { isManager, isSuperadmin } from "@/lib/auth";
import { NO_OWN_TOKEN_MESSAGE, resolveBankToken } from "@/lib/credentials";
import { listarExtracoesMercury, type ExtracaoMercury } from "@/lib/mercury";
import { fetchAllTransactions } from "@/lib/sync/mercury";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/accounts/[id]/extracoes — "Separar extrações" de uma conta Mercury (decisão do dono em 2026-10-30:
 * "1 conta por extração"). Antes, a conta lembrava UMA sub-conta da Mercury de cada vez e as outras
 * entravam nela quando alguém escolhia à mão — os lançamentos das 3 ficaram misturados, sem dizer de
 * qual vieram. Aqui: relê cada extração na Mercury, descobre de qual veio cada lançamento (pelo id) e
 *  - GET  = só o plano (quantos de cada extração; o que não achou em nenhuma);
 *  - POST = aplica: a conta fica com UMA extração (a já configurada, ou a com mais lançamentos) e cada
 *    outra extração ganha uma conta própria (mesmo token), com os lançamentos dela movidos pra lá.
 * Lançamento que não aparece em extração nenhuma fica onde está (e é contado). Só administradores.
 */

type Ctx = { params: Promise<{ id: string }> };

const nomeDe = (e: ExtracaoMercury) => String(e.nickname || e.name || e.id);
const configDe = (s: string | null): Record<string, unknown> => {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
};

async function planejar(user: AppUser, id: string) {
  if (!isManager(user.role)) throw new AccessError(403, "só administradores separam extrações");
  await assertAccount(user, id);
  const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { company: true } });
  if (account.bank !== "Mercury") throw new RequestError(400, "só contas Mercury têm várias extrações");
  const config = configDe(account.syncConfig);
  const entity = (config.mercuryEntity as string | undefined) ?? null;
  const key = await resolveBankToken("mercury", account, { allowGlobal: isSuperadmin(user.role), mercuryEntity: entity });
  if (!key) throw new RequestError(400, NO_OWN_TOKEN_MESSAGE);

  const extracoes = await listarExtracoesMercury(account.name, key);
  if (!extracoes.length) throw new RequestError(503, "a Mercury não listou as extrações desta chave — token vencido?");

  // relê cada extração desde (um pouco antes de) o lançamento mais antigo da conta
  const primeira = await prisma.transaction.findFirst({ where: { accountId: id }, orderBy: { date: "asc" }, select: { date: true } });
  const inicio = new Date((primeira?.date ?? new Date()).getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);
  const deQual = new Map<string, string>(); // id do lançamento na Mercury → extração
  for (const e of extracoes) {
    for (const tx of await fetchAllTransactions(key, e.id, inicio, hoje)) deQual.set(tx.id, e.id);
  }

  const locais = await prisma.transaction.findMany({ where: { accountId: id }, select: { id: true, reference: true } });
  const porExtracao = new Map<string, string[]>(extracoes.map((e) => [e.id, []]));
  let semExtracao = 0;
  for (const l of locais) {
    const e = l.reference ? deQual.get(l.reference) : undefined;
    if (e) porExtracao.get(e)!.push(l.id);
    else semExtracao++;
  }

  // a que fica: a já configurada (se ainda existe na Mercury); senão a com mais lançamentos
  const configurada = extracoes.find((e) => e.id === config.mercuryAccountId);
  const fica = configurada ?? [...extracoes].sort((a, b) => porExtracao.get(b.id)!.length - porExtracao.get(a.id)!.length)[0];

  // extração que JÁ é de outra conta local: os lançamentos vão pra ela (não cria outra)
  const outras = await prisma.account.findMany({ where: { id: { not: id }, bank: "Mercury", syncConfig: { not: null } }, select: { id: true, name: true, syncConfig: true } });
  const contaDaExtracao = new Map<string, { id: string; name: string }>();
  for (const o of outras) {
    const m = configDe(o.syncConfig).mercuryAccountId;
    if (typeof m === "string") contaDaExtracao.set(m, { id: o.id, name: o.name });
  }

  return { account, entity, extracoes, porExtracao, semExtracao, fica, contaDaExtracao };
}

type Plano = Awaited<ReturnType<typeof planejar>>;
const resumo = (p: Plano) => ({
  conta: p.account.name,
  extracoes: p.extracoes.map((e) => ({
    id: e.id,
    nome: nomeDe(e),
    tipo: e.kind === "credit" ? "crédito" : String(e.kind ?? "conta"),
    lancamentos: p.porExtracao.get(e.id)!.length,
    fica: e.id === p.fica.id,
    contaExistente: p.contaDaExtracao.get(e.id)?.name ?? null,
  })),
  semExtracao: p.semExtracao,
});

export const GET = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  return Response.json(resumo(await planejar(user, id)));
});

export const POST = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const p = await planejar(user, id);
  const { account } = p;
  const criadas: Array<{ id: string; nome: string; lancamentos: number }> = [];
  let duplicadas = 0;

  await prisma.$transaction(async (tx) => {
    for (const e of p.extracoes) {
      if (e.id === p.fica.id) continue;
      const ids = p.porExtracao.get(e.id)!;
      let destino = p.contaDaExtracao.get(e.id)?.id;
      if (!destino) {
        const nova = await tx.account.create({
          data: {
            companyId: account.companyId, bank: "Mercury", currency: account.currency, apiToken: account.apiToken,
            name: `${account.name} · ${nomeDe(e)}`,
            syncConfig: JSON.stringify({ mercuryAccountId: e.id, mercuryEntity: p.entity ?? "activeview" }),
          },
        });
        destino = nova.id;
        criadas.push({ id: nova.id, nome: nova.name, lancamentos: ids.length });
      }
      // já existe na conta de destino (mesma referência) = duplicado: fica onde está e é contado
      const refs = await tx.transaction.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } });
      const jaLa = new Set(
        (await tx.transaction.findMany({ where: { accountId: destino, reference: { in: refs.map((r) => r.reference!).filter(Boolean) } }, select: { reference: true } })).map((r) => r.reference),
      );
      const mover = refs.filter((r) => !jaLa.has(r.reference)).map((r) => r.id);
      duplicadas += refs.length - mover.length;
      if (mover.length) await tx.transaction.updateMany({ where: { id: { in: mover } }, data: { accountId: destino } });
    }
    const nomeFica = nomeDe(p.fica);
    await tx.account.update({
      where: { id },
      data: {
        syncConfig: JSON.stringify({ mercuryAccountId: p.fica.id, mercuryEntity: p.entity ?? "activeview" }),
        ...(account.name.includes(nomeFica) ? {} : { name: `${account.name} · ${nomeFica}` }),
      },
    });
  }, { timeout: 120_000 });

  return Response.json({ ...resumo(p), criadas, duplicadas });
});
