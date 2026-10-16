import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as fetchRoute from "@/app/api/exchange-rates/fetch/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

// Câmbio: sem chave Wise GLOBAL no .env, a busca usa a chave Wise já guardada no banco (16/10/2026).
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let auths: string[];
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  auths = [];
  vi.stubEnv("WISE_API_KEY", "");
  vi.stubEnv("WISE_API_KEY_ACTIVEVIEW_LLC", "");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(input, init);
    auths.push(r.headers.get("authorization") ?? "");
    return Response.json([{ rate: 1.15925 }]);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const buscar = () => fetchRoute.POST(req("/api/exchange-rates/fetch", { method: "POST", json: { currencies: ["EUR", "USD"], from: "2026-09", to: "2026-09" } }));

describe("POST /api/exchange-rates/fetch", () => {
  it("sem chave global, usa a chave Wise de uma conta e grava a cotação do mês", async () => {
    await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "Wise", currency: "EUR", name: "Wise Pixel", apiToken: "tok-wise-do-banco" } });
    loginAs(s.users.root);
    const res = await buscar();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fetched: 1, failed: 0, total: 1 }); // USD não se converte
    expect(auths).toEqual(["Bearer tok-wise-do-banco"]);
    expect((await prisma.exchangeRate.findUniqueOrThrow({ where: { currency_month: { currency: "EUR", month: "2026-09" } } })).rateToUsd).toBe(1.15925);
  });

  it("sem nenhuma chave Wise no sistema: erro claro, nada gravado", async () => {
    loginAs(s.users.root);
    const res = await buscar();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/nenhuma chave Wise/);
    expect(await prisma.exchangeRate.count()).toBe(0);
  });

  it("member não busca câmbio (configuração: só admins)", async () => {
    loginAs(s.users.pixel);
    expect((await buscar()).status).toBe(403);
  });
});
