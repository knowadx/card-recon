import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getCurrentUser, isSuperadmin, scopes } from "./auth";

/**
 * Permissão por grupo — a peça ÚNICA que as rotas usam. Regras:
 *  - superadmin vê e altera tudo;
 *  - os demais veem e alteram só o que é das holdings deles (Membership) ou das operações
 *    deles (OperationMembership), com o mesmo critério que o GET /api/transactions já usava;
 *  - fora do escopo responde 404 (não confirma que o recurso existe);
 *  - configuração global (categorias, gráficos, câmbio, ajustes, admin/*, integrações) só superadmin altera.
 */

export class AccessError extends Error {
  constructor(public status: 401 | 403 | 404, message: string) {
    super(message);
  }
}

export type AppUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const NONE = "__sem_escopo__"; // id que nunca existe: escopo vazio = não vê nada

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AccessError(401, "não autenticado");
  return user;
}

export async function requireSuperadmin(): Promise<AppUser> {
  const user = await requireUser();
  if (!isSuperadmin(user.role)) throw new AccessError(403, "só o administrador geral pode fazer isso");
  return user;
}

/** Contas visíveis: da empresa de uma holding minha OU de uma operação minha. */
export async function accountScope(user: AppUser): Promise<Prisma.AccountWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds, operationIds } = await scopes(user.id);
  const or: Prisma.AccountWhereInput[] = [];
  if (holdingIds.length) or.push({ company: { holdingId: { in: holdingIds } } });
  if (operationIds.length) or.push({ operationId: { in: operationIds } });
  return or.length ? { OR: or } : { id: NONE };
}

/** Transações visíveis: conta no meu escopo OU a própria transação marcada numa operação minha. */
export async function transactionScope(user: AppUser): Promise<Prisma.TransactionWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds, operationIds } = await scopes(user.id);
  const or: Prisma.TransactionWhereInput[] = [];
  if (holdingIds.length) or.push({ account: { company: { holdingId: { in: holdingIds } } } });
  if (operationIds.length) {
    or.push({ operationId: { in: operationIds } });
    or.push({ account: { operationId: { in: operationIds } } });
  }
  return or.length ? { OR: or } : { id: NONE };
}

/** Empresas visíveis: de uma holding minha OU com conta numa operação minha. */
export async function companyScope(user: AppUser): Promise<Prisma.CompanyWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds, operationIds } = await scopes(user.id);
  const or: Prisma.CompanyWhereInput[] = [];
  if (holdingIds.length) or.push({ holdingId: { in: holdingIds } });
  if (operationIds.length) or.push({ accounts: { some: { operationId: { in: operationIds } } } });
  return or.length ? { OR: or } : { id: NONE };
}

/** IDs das contas visíveis — para filtros em tabelas sem relação direta (ex.: agregações). */
export async function accountIdsInScope(user: AppUser): Promise<string[] | "all"> {
  if (isSuperadmin(user.role)) return "all";
  const rows = await prisma.account.findMany({ where: await accountScope(user), select: { id: true } });
  return rows.map((r) => r.id);
}

export async function assertAccount(user: AppUser, accountId: string): Promise<void> {
  const found = await prisma.account.findFirst({
    where: { AND: [{ id: accountId }, await accountScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "conta não encontrada");
}

export async function assertTransaction(user: AppUser, transactionId: string): Promise<void> {
  const found = await prisma.transaction.findFirst({
    where: { AND: [{ id: transactionId }, await transactionScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "transação não encontrada");
}

/** Várias transações de uma vez (ações em lote): TODAS precisam estar no escopo. */
export async function assertTransactions(user: AppUser, transactionIds: string[]): Promise<void> {
  const ids = Array.from(new Set(transactionIds));
  if (ids.length === 0) return;
  const count = await prisma.transaction.count({ where: { AND: [{ id: { in: ids } }, await transactionScope(user)] } });
  if (count !== ids.length) throw new AccessError(404, "transação não encontrada");
}

export async function assertCompany(user: AppUser, companyId: string): Promise<void> {
  const found = await prisma.company.findFirst({
    where: { AND: [{ id: companyId }, await companyScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "empresa não encontrada");
}

/** Holding em que o usuário pode criar/mover coisas (superadmin: qualquer uma). */
export async function assertHolding(user: AppUser, holdingId: string): Promise<void> {
  if (isSuperadmin(user.role)) {
    const exists = await prisma.holding.findUnique({ where: { id: holdingId }, select: { id: true } });
    if (!exists) throw new AccessError(404, "holding não encontrada");
    return;
  }
  const { holdingIds } = await scopes(user.id);
  if (!holdingIds.includes(holdingId)) throw new AccessError(404, "holding não encontrada");
}

/** Embrulha um handler de rota: AccessError vira resposta JSON com o status certo. */
export function guarded<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof AccessError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}
