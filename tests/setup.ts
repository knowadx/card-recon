import { vi } from "vitest";

/**
 * next/headers fora do Next: o teste diz qual cookie e quais cabeçalhos o "navegador" manda.
 * Estado em globalThis porque o mock é içado acima dos imports.
 */
type FakeRequestState = { cookies: Record<string, string>; headers: Record<string, string> };
const g = globalThis as unknown as { __fakeRequest: FakeRequestState };
g.__fakeRequest = { cookies: {}, headers: {} };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = g.__fakeRequest.cookies[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(g.__fakeRequest.headers),
}));
