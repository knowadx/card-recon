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

/** IDs de empresas que o usuário pode ver. Admin = todas. */
export async function accessibleCompanyIds(userId: string, role: string): Promise<string[] | "all"> {
  if (role === "admin") return "all";
  const m = await prisma.membership.findMany({ where: { userId }, select: { companyId: true } });
  return m.map((x) => x.companyId);
}

/** Empresas que a sessão atual pode ver: "all" (admin) ou lista de ids. */
export async function scopedCompanyIds(): Promise<string[] | "all"> {
  const s = await getSession();
  if (!s) return [];
  return accessibleCompanyIds(s.userId, s.role);
}

/** Garante 1 admin a partir das envs ADMIN_EMAIL/ADMIN_PASSWORD se não houver usuários. */
export async function ensureSeedAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return;
  await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: hashPassword(pw), role: "admin", name: "Admin" },
  });
}
