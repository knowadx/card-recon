import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as metaAuth from "@/app/api/meta/auth/route";
import * as metaCallback from "@/app/api/meta/callback/route";
import * as revolutCallback from "@/app/api/revolut/callback/route";
import { escapeHtml } from "@/lib/html";
import { loginAs, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
});
afterEach(() => vi.unstubAllEnvs());

const XSS = `<script>alert(document.cookie)</script>`;
const nreq = (path: string, cookie?: string) =>
  new NextRequest(`https://app.exemplo.com${path}`, { headers: cookie ? { cookie } : {} });

describe("escapeHtml", () => {
  it("neutraliza tags e aspas", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("/api/meta/callback", () => {
  it("XSS: o erro vindo na URL aparece escapado, mesmo sem sessão (rota pública)", async () => {
    const res = await metaCallback.GET(nreq(`/api/meta/callback?error=${encodeURIComponent(XSS)}`));
    const body = await res.text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("CSRF: sem o cookie de quem iniciou, ou com state diferente, recusa antes de trocar o código", async () => {
    loginAs(s.users.operador);
    const op = s.operations.pixel.id;
    const noCookie = await metaCallback.GET(nreq(`/api/meta/callback?code=abc&state=${op}:x`));
    expect(noCookie.status).toBe(400);
    const mismatch = await metaCallback.GET(nreq(`/api/meta/callback?code=abc&state=${op}:atacante`, `cr_meta_op=${op}:legitimo`));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain("Conexão não reconhecida");
  });

  it("o /api/meta/auth grava no cookie exatamente o state aleatório que manda pra Meta", async () => {
    vi.stubEnv("META_APP_ID", "app123");
    loginAs(s.users.operador);
    const res = await metaAuth.GET(new Request(`https://app.exemplo.com/api/meta/auth?operationId=${s.operations.pixel.id}`));
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    expect(state).toMatch(new RegExp(`^${s.operations.pixel.id}:[0-9a-f]{32}$`));
    expect(res.headers.get("set-cookie")).toContain(`cr_meta_op=${encodeURIComponent(state)}`);
  });
});

describe("/api/revolut/callback", () => {
  it("XSS: erro escapado; CSRF: state diferente do cookie de quem iniciou = recusa", async () => {
    loginAs(s.users.root);
    const xss = await revolutCallback.GET(nreq(`/api/revolut/callback?error=${encodeURIComponent(XSS)}`));
    expect(await xss.text()).not.toContain("<script>");
    const mismatch = await revolutCallback.GET(nreq(`/api/revolut/callback?code=abc&state=EmpresaAtacante`, `cr_revolut_company=${encodeURIComponent("Pixel Ads LLC")}`));
    expect(mismatch.status).toBe(400);
    const noCookie = await revolutCallback.GET(nreq(`/api/revolut/callback?code=abc&state=Pixel%20Ads%20LLC`));
    expect(noCookie.status).toBe(400);
  });
});
