import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";

/**
 * Login pela Cloudflare Access (mesmo desenho do hash-ads: backend/app/core/access_jwt.py).
 *
 * A Cloudflare faz o login (PIN por e-mail) e manda, em todo pedido, o cabeçalho
 * `Cf-Access-Jwt-Assertion` com um JWT assinado por ela. Aqui conferimos esse JWT:
 * RS256 com a chave pública da equipe (JWKS de https://<equipe>/cdn-cgi/access/certs),
 * `aud` = AUD do app no Access, `iss` = https://<equipe>, validade (folga de 60 s) e e-mail.
 *
 * Só o JWT CONFERIDO identifica alguém. `Cf-Access-Authenticated-User-Email` e qualquer outro
 * cabeçalho de identidade são ignorados: quem alcança o app escreve o cabeçalho que quiser.
 *
 * Estados (variáveis ACCESS_TEAM_DOMAIN e ACCESS_AUD):
 *   desligado  → as duas vazias: vale o login antigo (cookie), até a virada.
 *   incompleto → só uma, ou equipe fora de <nome>.cloudflareaccess.com: ninguém entra
 *                (erro de configuração FECHA, nunca abre).
 *   ligado     → só entra quem trouxer JWT válido.
 */

export type LoginMode = "desligado" | "incompleto" | "ligado";
export interface LoginConfig {
  mode: LoginMode;
  team: string; // <nome>.cloudflareaccess.com
  aud: string;
}

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const MAX_JWT_LENGTH = 8192; // o da Cloudflare tem ~1 KB
const TEAM_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

function normalizeTeam(raw: string | undefined): string {
  let v = (raw ?? "").trim().toLowerCase();
  if (v.startsWith("https://")) v = v.slice("https://".length);
  return v.replace(/\/+$/, "");
}

export function loginConfig(env: Record<string, string | undefined> = process.env): LoginConfig {
  const team = normalizeTeam(env.ACCESS_TEAM_DOMAIN);
  const aud = (env.ACCESS_AUD ?? "").trim();
  if (!team && !aud) return { mode: "desligado", team: "", aud: "" };
  if (!team || !aud || !TEAM_RE.test(team)) return { mode: "incompleto", team, aud };
  return { mode: "ligado", team, aud };
}

export class JwtRefused extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

// Chaves da equipe: o jose guarda em cache e só busca de novo quando aparece um kid desconhecido.
let remoteKeys: { team: string; getKey: JWTVerifyGetKey } | null = null;
let keysForTests: JWTVerifyGetKey | null = null;

/** Só para testes: troca a busca das chaves da Cloudflare por um conjunto local. */
export function setAccessKeysForTests(getKey: JWTVerifyGetKey | null) {
  keysForTests = getKey;
}

let devKeys: JWTVerifyGetKey | null = null;

function keysFor(team: string): JWTVerifyGetKey {
  if (keysForTests) return keysForTests;
  // Só no desenvolvimento local (next dev): ACCESS_DEV_JWKS = chave PÚBLICA de um par local, pra ver as
  // telas sem a Cloudflare (um proxy local assina o JWT, como a Cloudflare faz). Em produção
  // (NODE_ENV=production) isto é ignorado — lá só valem as chaves da equipe.
  const devJwks = process.env.NODE_ENV !== "production" ? process.env.ACCESS_DEV_JWKS : undefined;
  if (devJwks) return (devKeys ??= createLocalJWKSet(JSON.parse(devJwks) as JSONWebKeySet));
  if (!remoteKeys || remoteKeys.team !== team) {
    remoteKeys = { team, getKey: createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)) };
  }
  return remoteKeys.getKey;
}

/** Confere o JWT da Cloudflare e devolve o e-mail (minúsculas). Recusa = JwtRefused(motivo). */
export async function verifyAccessJwt(token: string | null | undefined, cfg: LoginConfig = loginConfig()): Promise<string> {
  if (cfg.mode !== "ligado") throw new JwtRefused(cfg.mode === "desligado" ? "DESLIGADO" : "INCOMPLETO");
  if (!token) throw new JwtRefused("AUSENTE");
  if (token.length > MAX_JWT_LENGTH) throw new JwtRefused("GRANDE_DEMAIS");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keysFor(cfg.team), {
      issuer: `https://${cfg.team}`,
      audience: cfg.aud,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch (e) {
    const code = (e as { code?: string }).code ?? "INVALIDO";
    throw new JwtRefused(code);
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new JwtRefused("SEM_EMAIL");
  return email;
}
