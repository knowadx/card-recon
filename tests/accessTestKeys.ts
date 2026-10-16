import { createSign, generateKeyPairSync } from "node:crypto";

/**
 * "Cloudflare" dos testes: uma chave RSA local no lugar das chaves da equipe. O app confere o JWT
 * do MESMO jeito que em produção (RS256, iss, aud, exp) — só a chave pública vem daqui
 * (setAccessKeysForTests, em tests/setup.ts). Equipe e AUD = os do vitest.config.ts.
 */
export const TEST_TEAM = process.env.ACCESS_TEAM_DOMAIN || "pixel-teste.cloudflareaccess.com";
export const TEST_AUD = process.env.ACCESS_AUD || "aud-de-teste";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const TEST_PUBLIC_JWK = { ...publicKey.export({ format: "jwk" }), kid: "teste", alg: "RS256" };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** JWT como o da Cloudflare, assinado com a chave de teste (síncrono, pro loginAs). */
export function signTestJwt(claims: Record<string, unknown>): string {
  const agora = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "teste", typ: "JWT" });
  const payload = b64({ iss: `https://${TEST_TEAM}`, aud: TEST_AUD, iat: agora, exp: agora + 3600, ...claims });
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}
