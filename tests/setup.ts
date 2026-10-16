import { vi } from "vitest";
import { createLocalJWKSet } from "jose";
import { setAccessKeysForTests } from "@/lib/accessJwt";
import { TEST_PUBLIC_JWK } from "./accessTestKeys";

/**
 * next/headers fora do Next: o teste diz quais cabeçalhos o "navegador" manda (o loginAs põe o JWT
 * da Cloudflare). Estado em globalThis porque o mock é içado acima dos imports.
 */
type FakeRequestState = { headers: Record<string, string> };
const g = globalThis as unknown as { __fakeRequest: FakeRequestState };
g.__fakeRequest = { headers: {} };

vi.mock("next/headers", () => ({
  headers: async () => new Headers(g.__fakeRequest.headers),
}));

// a "Cloudflare" dos testes: o app confere os JWTs contra esta chave (src/lib/accessJwt.ts)
setAccessKeysForTests(createLocalJWKSet({ keys: [TEST_PUBLIC_JWK as Parameters<typeof createLocalJWKSet>[0]["keys"][number]] }));
