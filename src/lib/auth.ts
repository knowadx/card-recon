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
  // Lê o pedido ANTES de tudo: isso obriga o Next a montar quem usa esta função A CADA ACESSO. Sem isso,
  // no build (sem as envs da Cloudflare) a página era pré-montada com "sem usuário" e o redirect ficava
  // gravado — foi o que fez o /control voltar sempre pra home (2026-10-16).
  const pedido = await headers();
  const cfg = loginConfig();
  if (cfg.mode !== "ligado") return null; // sem a Cloudflare configurada (ou mal configurada) fecha
  let email: string;
  try {
    email = await verifyAccessJwt(pedido.get(ACCESS_JWT_HEADER), cfg);
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
/** Pode gerenciar (criar usuários/operações/conceder acesso) — superadmin global, admin no escopo dele. */
export function isManager(role: string): boolean {
  return role === "superadmin" || role === "admin";
}

/**
 * Operações que o usuário OPERA — a regra ÚNICA pra conectar/desconectar/sincronizar o Meta de uma
 * operação, ver os dados Meta dela e conceder acesso a ela: superadmin = todas (null = sem filtro);
 * os demais = só as que é membro. A LISTA de operações (etiquetas) é global, igual pra todo mundo;
 * isto aqui é quem manda em cada uma (decisão do dono em 2026-10-30: operação sem holding dona).
 */
export async function memberOperationsWhere(user: { id: string; role: string }): Promise<Prisma.OperationWhereInput | null> {
  if (isSuperadmin(user.role)) return null;
  return { memberships: { some: { userId: user.id } } };
}

/** O usuário opera esta operação (memberOperationsWhere)? Retorna a operação ou null. */
export async function findMemberOperation(
  user: { id: string; role: string },
  operationId: string,
): Promise<{ id: string; name: string } | null> {
  const scope = await memberOperationsWhere(user);
  return prisma.operation.findFirst({
    where: { AND: [{ id: operationId }, ...(scope ? [scope] : [])] },
    select: { id: true, name: true },
  });
}

/**
 * O que um gestor pode conceder/administrar: as holdings dele + as operações que ele opera.
 * Superadmin = tudo. Peça única das rotas de usuários (era copiada nas duas).
 */
export async function manageScope(user: { id: string; role: string }) {
  if (isSuperadmin(user.role)) return { all: true as const, holdingIds: [] as string[], operationIds: [] as string[] };
  const { holdingIds, operationIds } = await scopes(user.id);
  return { all: false as const, holdingIds, operationIds };
}

/** IDs de holdings que o usuário pode ver. Superadmin = todos; admin/member = as do vínculo. */
export async function accessibleHoldingIds(userId: string, role: string): Promise<string[] | "all"> {
  if (isSuperadmin(role)) return "all";
  const m = await prisma.membership.findMany({ where: { userId }, select: { holdingId: true } });
  return m.map((x) => x.holdingId);
}
