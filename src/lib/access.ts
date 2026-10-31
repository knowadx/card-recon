import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getCurrentUser, isManager, isSuperadmin, scopes } from "./auth";

/**
 * Permissão por grupo — a peça ÚNICA que as rotas usam. Regras:
 *  - superadmin vê e altera tudo;
 *  - os demais veem e alteram só o que é das holdings deles (Membership); a operação
 *    (OperationMembership) dá acesso SÓ às transações com split daquela operação — não a contas
 *    nem empresas (a operação mora só no split, decisão do dono em 2026-10-30);
 *  - fora do escopo responde 404 (não confirma que o recurso existe);
 *  - configuração global (categorias, gráficos, câmbio, ajustes, admin/*, integrações) só superadmin altera.
 */

export class AccessError extends Error {
  constructor(public status: 401 | 403 | 404, message: string) {
    super(message);
  }
}

/** Pedido inválido (dado errado, conflito, arquivo grande/tipo proibido, armazenamento fora). */
export class RequestError extends Error {
  constructor(public status: 400 | 409 | 413 | 415 | 503, message: string) {
    super(message);
  }
}

export type AppUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const NONE = "__sem_escopo__"; // id que nunca existe: escopo vazio = não vê nada

/**
 * Id que veio do pedido precisa ser texto não vazio. Sem isso, um id `undefined` some do filtro do
 * Prisma ({ id: undefined } é ignorado) e a checagem passaria se o usuário visse QUALQUER registro.
 */
function validId(id: unknown, what: string): string {
  if (typeof id !== "string" || id.trim() === "") throw new AccessError(404, `${what} não encontrada`);
  return id;
}

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

/**
 * Gestor = superadmin ou "admin" da equipe. Altera a configuração do app (categorias, gráficos,
 * plano, câmbio, período de sincronização). "member" só lê. Decisão do dono em 2026-10-15.
 */
export async function requireManager(): Promise<AppUser> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores alteram a configuração");
  return user;
}

/** Contas visíveis: das empresas das holdings minhas. (Operação não dá conta: ela mora no split.) */
export async function accountScope(user: AppUser): Promise<Prisma.AccountWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds } = await scopes(user.id);
  return holdingIds.length ? { company: { holdingId: { in: holdingIds } } } : { id: NONE };
}

/** Transações visíveis: conta no meu escopo OU algum split marcado numa operação minha. */
export async function transactionScope(user: AppUser): Promise<Prisma.TransactionWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds, operationIds } = await scopes(user.id);
  const or: Prisma.TransactionWhereInput[] = [];
  if (holdingIds.length) or.push({ account: { company: { holdingId: { in: holdingIds } } } });
  if (operationIds.length) or.push({ splits: { some: { operationId: { in: operationIds } } } });
  return or.length ? { OR: or } : { id: NONE };
}

/** Empresas visíveis: das holdings minhas. */
export async function companyScope(user: AppUser): Promise<Prisma.CompanyWhereInput> {
  if (isSuperadmin(user.role)) return {};
  const { holdingIds } = await scopes(user.id);
  return holdingIds.length ? { holdingId: { in: holdingIds } } : { id: NONE };
}

/** IDs das contas visíveis — para filtros em tabelas sem relação direta (ex.: agregações). */
export async function accountIdsInScope(user: AppUser): Promise<string[] | "all"> {
  if (isSuperadmin(user.role)) return "all";
  const rows = await prisma.account.findMany({ where: await accountScope(user), select: { id: true } });
  return rows.map((r) => r.id);
}

export async function assertAccount(user: AppUser, accountId: string): Promise<void> {
  validId(accountId, "conta");
  const found = await prisma.account.findFirst({
    where: { AND: [{ id: accountId }, await accountScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "conta não encontrada");
}

export async function assertTransaction(user: AppUser, transactionId: string): Promise<void> {
  validId(transactionId, "transação");
  const found = await prisma.transaction.findFirst({
    where: { AND: [{ id: transactionId }, await transactionScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "transação não encontrada");
}

/** Várias transações de uma vez (ações em lote): TODAS precisam estar no escopo. */
export async function assertTransactions(user: AppUser, transactionIds: string[]): Promise<void> {
  const ids = Array.from(new Set(transactionIds.map((id) => validId(id, "transação"))));
  if (ids.length === 0) return;
  const count = await prisma.transaction.count({ where: { AND: [{ id: { in: ids } }, await transactionScope(user)] } });
  if (count !== ids.length) throw new AccessError(404, "transação não encontrada");
}

export async function assertCompany(user: AppUser, companyId: string): Promise<void> {
  validId(companyId, "empresa");
  const found = await prisma.company.findFirst({
    where: { AND: [{ id: companyId }, await companyScope(user)] },
    select: { id: true },
  });
  if (!found) throw new AccessError(404, "empresa não encontrada");
}

/** Holding em que o usuário pode criar/mover coisas (superadmin: qualquer uma). */
export async function assertHolding(user: AppUser, holdingId: string): Promise<void> {
  validId(holdingId, "holding");
  if (isSuperadmin(user.role)) {
    const exists = await prisma.holding.findUnique({ where: { id: holdingId }, select: { id: true } });
    if (!exists) throw new AccessError(404, "holding não encontrada");
    return;
  }
  const { holdingIds } = await scopes(user.id);
  if (!holdingIds.includes(holdingId)) throw new AccessError(404, "holding não encontrada");
}

/**
 * Operação que dá pra usar como etiqueta (split, filtro do P&L): a lista é GLOBAL, como categoria —
 * basta existir. Quem MANDA na operação (Meta, conceder acesso) é outra regra: findMemberOperation.
 */
export async function assertOperation(_user: AppUser, operationId: string): Promise<void> {
  validId(operationId, "operação");
  const found = await prisma.operation.findUnique({ where: { id: operationId }, select: { id: true } });
  if (!found) throw new AccessError(404, "operação não encontrada");
}

/** Embrulha um handler de rota: AccessError/RequestError vira resposta JSON com o status certo. */
export function guarded<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof AccessError || e instanceof RequestError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}
