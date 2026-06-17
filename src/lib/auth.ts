import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

/**
 * Auth multi-usuário com cookie de sessão ASSINADO (stateless).
 * payload = userId.role.exp  → cookie = base64url(payload).HMAC(secret,payload)
 * O middleware (edge) só valida a assinatura+exp (sem DB). O servidor (node)
 * usa getSession()/getCurrentUser() e o escopo por empresa.
 */

const COOKIE = "cr_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function secret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "card-recon-dev-secret";
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const calc = scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, "hex");
  return calc.length === known.length && timingSafeEqual(calc, known);
}

export function signSession(userId: string, role: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${userId}.${role}.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${b64url(payload)}.${sig}`;
}

export interface SessionData {
  userId: string;
  role: string;
}

function verifyToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [userId, role, expStr] = payload.split(".");
  if (!userId || Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return { userId, role };
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE;

/** Lê a sessão do cookie (server components / route handlers). */
export async function getSession(): Promise<SessionData | null> {
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value);
}

export async function getCurrentUser() {
  const s = await getSession();
  if (!s) return null;
  const user = await prisma.user.findUnique({ where: { id: s.userId } });
  if (!user || !user.isActive) return null;
  return user;
}

async function scopes(userId: string) {
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
 * A operação está no escopo do usuário? superadmin = qualquer uma; admin = as da(s)
 * holding(s) dele ou que é membro; member = só as que é membro. Retorna a operação ou null.
 */
export async function findAccessibleOperation(
  user: { id: string; role: string },
  operationId: string,
): Promise<{ id: string; name: string } | null> {
  if (isSuperadmin(user.role)) {
    return prisma.operation.findUnique({ where: { id: operationId }, select: { id: true, name: true } });
  }
  const holdings = await accessibleHoldingIds(user.id, user.role);
  const hids = holdings === "all" ? [] : holdings;
  return prisma.operation.findFirst({
    where: {
      id: operationId,
      OR: [
        ...(hids.length ? [{ holdingId: { in: hids } }] : []),
        { memberships: { some: { userId: user.id } } },
      ],
    },
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

/** Garante 1 admin a partir das envs ADMIN_EMAIL/ADMIN_PASSWORD se não houver usuários. */
export async function ensureSeedAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return;
  await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: hashPassword(pw), role: "superadmin", name: "Admin" },
  });
}
