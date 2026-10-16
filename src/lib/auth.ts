import { headers } from "next/headers";
import { prisma } from "./db";
import { ACCESS_JWT_HEADER, loginConfig, verifyAccessJwt } from "./accessJwt";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Identidade de quem chama — SÓ pelo login da Cloudflare (decisão do dono em 2026-10-16: o login
 * antigo por cookie/senha foi removido). O JWT conferido diz o e-mail; o cadastro (User ativo) diz
 * quem é. Papel e escopo vêm SEMPRE do banco. Sem a Cloudflare configurada, ninguém entra.
 */

export async function getCurrentUser() {
  const cfg = loginConfig();
  if (cfg.mode !== "ligado") return null; // sem a Cloudflare configurada (ou mal configurada) fecha
  let email: string;
  try {
    email = await verifyAccessJwt((await headers()).get(ACCESS_JWT_HEADER), cfg);
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  return user && user.isActive ? user : null;
}

export async function scopes(userId: string) {
  const [h, o] = await Promise.all([
    prisma.membership.findMany({ where: { userId }, select: { holdingId: true } }),
    prisma.operationMembership.findMany({ where: { userId }, select: { operationId: true } }),
  ]);
  return { holdingIds: h.map((x) => x.holdingId), operationIds: o.map((x) => x.operationId) };
}

/** Vê tudo, irrestrito (dono da plataforma). */
export function isSuperadmin(role: string): boolean {
  return role === "superadmin";
}
/** Pode gerenciar (criar usuários/operações/conceder acesso) — superadmin global, admin na sua holding. */
export function isManager(role: string): boolean {
  return role === "superadmin" || role === "admin";
}

/**
 * Operações no escopo do usuário — a regra ÚNICA: superadmin = todas (null = sem filtro);
 * admin = as da(s) holding(s) dele ou que é membro; member = só as que é membro.
 */
export async function accessibleOperationsWhere(user: { id: string; role: string }): Promise<Prisma.OperationWhereInput | null> {
  if (isSuperadmin(user.role)) return null;
  const holdings = await accessibleHoldingIds(user.id, user.role);
  const hids = holdings === "all" ? [] : holdings;
  return {
    OR: [
      ...(hids.length ? [{ holdingId: { in: hids } }] : []),
      { memberships: { some: { userId: user.id } } },
    ],
  };
}

/** A operação está no escopo do usuário (accessibleOperationsWhere)? Retorna a operação ou null. */
export async function findAccessibleOperation(
  user: { id: string; role: string },
  operationId: string,
): Promise<{ id: string; name: string } | null> {
  const scope = await accessibleOperationsWhere(user);
  return prisma.operation.findFirst({
    where: { AND: [{ id: operationId }, ...(scope ? [scope] : [])] },
    select: { id: true, name: true },
  });
}

/** IDs de holdings que o usuário pode ver. Superadmin = todos; admin/member = as do vínculo. */
export async function accessibleHoldingIds(userId: string, role: string): Promise<string[] | "all"> {
  if (isSuperadmin(role)) return "all";
  const m = await prisma.membership.findMany({ where: { userId }, select: { holdingId: true } });
  return m.map((x) => x.holdingId);
}

/** IDs de CONTAS que o usuário pode ver: contas das holdings dele OU das operações dele. */
export async function accessibleAccountIds(userId: string, role: string): Promise<string[] | "all"> {
  if (isSuperadmin(role)) return "all";
  const { holdingIds, operationIds } = await scopes(userId);
  if (holdingIds.length === 0 && operationIds.length === 0) return [];
  const accounts = await prisma.account.findMany({
    where: {
      OR: [
        ...(holdingIds.length ? [{ company: { holdingId: { in: holdingIds } } }] : []),
        ...(operationIds.length ? [{ operationId: { in: operationIds } }] : []),
      ],
    },
    select: { id: true },
  });
  return accounts.map((a) => a.id);
}

/** IDs de empresas que o usuário pode ver: das holdings dele + das contas das operações dele. */
export async function accessibleCompanyIds(userId: string, role: string): Promise<string[] | "all"> {
  if (isSuperadmin(role)) return "all";
  const { holdingIds, operationIds } = await scopes(userId);
  const ids = new Set<string>();
  if (holdingIds.length) {
    const c = await prisma.company.findMany({ where: { holdingId: { in: holdingIds } }, select: { id: true } });
    c.forEach((x) => ids.add(x.id));
  }
  if (operationIds.length) {
    const a = await prisma.account.findMany({ where: { operationId: { in: operationIds } }, select: { companyId: true } });
    a.forEach((x) => ids.add(x.companyId));
  }
  return Array.from(ids);
}

/** Empresas que a sessão atual pode ver: "all" (superadmin) ou lista de ids. Role vem do DB. */
export async function scopedCompanyIds(): Promise<string[] | "all"> {
  const u = await getCurrentUser();
  if (!u) return [];
  return accessibleCompanyIds(u.id, u.role);
}

/** Contas que a sessão atual pode ver: "all" (superadmin) ou lista de ids. Role vem do DB. */
export async function scopedAccountIds(): Promise<string[] | "all"> {
  const u = await getCurrentUser();
  if (!u) return [];
  return accessibleAccountIds(u.id, u.role);
}

/** Escopos da sessão (holdings + operações) p/ filtro de transações. seeAll = superadmin. Role vem do DB. */
export async function sessionScopes(): Promise<{ isAdmin: boolean; holdingIds: string[]; operationIds: string[] }> {
  const u = await getCurrentUser();
  if (!u) return { isAdmin: false, holdingIds: [], operationIds: [] };
  if (isSuperadmin(u.role)) return { isAdmin: true, holdingIds: [], operationIds: [] };
  const sc = await scopes(u.id);
  return { isAdmin: false, ...sc };
}

