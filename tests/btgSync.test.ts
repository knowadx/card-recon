import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import * as btgAuth from "@/app/api/btg/auth/route";
import * as btgCallback from "@/app/api/btg/callback/route";
import * as syncBtg from "@/app/api/sync/btg/route";
import * as syncAll from "@/app/api/sync/all/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Conector BTG Pactual Empresas (pedido do dono em 2026-10-24). O BTG aqui é falso, mas fala o
 * formato da documentação oficial (Authorization Code com Basic, /{CNPJ}/banking/accounts,
 * /statements com dailyMovements e _links.next). Nada sai da máquina.
 */
const ID = "https://id.sandbox.btgpactual.com";
const API = "https://api.sandbox.empresas.btgpactual.com";
const CNPJ = "45700852000120";
const CONTA_BTG = `${CNPJ}-208-1-777776752`;

type Chamada = { metodo: string; url: string; auth: string | null; corpo: string };
let chamadas: Chamada[];
let contasNoBtg: Array<{ accountId: string; number: string; branchCode: string }>;
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let contaBtg: { id: string };

const movimento = (id: number, type: "debit" | "credit", amount: number, description: string, descriptionDetails?: string, dateHour = "2026-10-05T10:00:00Z") =>
  ({ id, type, amount, description, descriptionDetails, dateHour, category: { name: "Cartão", description: "Cartão" } });

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.credential.deleteMany();
  vi.stubEnv("BTG_CLIENT_ID", "cliente-teste");
  vi.stubEnv("BTG_CLIENT_SECRET", "segredo-teste");
  vi.stubEnv("BTG_AMBIENTE", "sandbox");
  await prisma.company.update({ where: { id: s.companies.pixel.id }, data: { cnpj: CNPJ } });
  contaBtg = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "BTG", currency: "BRL", name: "BTG Pixel", operationId: s.operations.pixel.id } });
  contasNoBtg = [{ accountId: CONTA_BTG, number: "777776752", branchCode: "1" }];
  chamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    chamadas.push({ metodo: init?.method ?? "GET", url: url.toString(), auth: headers.get("authorization"), corpo: String(init?.body ?? "") });
    if (url.origin === ID && url.pathname === "/oauth2/token") {
      const f = new URLSearchParams(String(init?.body));
      if (f.get("grant_type") === "authorization_code") return Response.json({ access_token: "acesso-novo", refresh_token: "renova-1", expires_in: 86400, token_type: "Bearer" });
      if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === "renova-1") return Response.json({ access_token: "acesso-renovado", refresh_token: "renova-2", expires_in: 86400 });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.origin === API && url.pathname === `/${CNPJ}/banking/accounts`) return Response.json({ data: contasNoBtg });
    if (url.origin === API && url.pathname === `/${CNPJ}/banking/accounts/${CONTA_BTG}/statements`) {
      if (url.searchParams.get("page") === "2") {
        return Response.json({ _links: { next: null }, data: { dailyMovements: [{ date: "2026-10-06T00:00:00", movements: [movimento(3, "credit", 5000, "Pix recebido", "Banco 341 | CNPJ 11.***")] }] } });
      }
      return Response.json({
        _links: { next: `${url.toString()}&page=2` },
        data: { dailyMovements: [{ date: "2026-10-05T00:00:00", movements: [
          movimento(1, "debit", 1234.56, "Compra no cartão", "FACEBK *ABCD1234XY"),
          movimento(2, "debit", 30, "Tarifa"),
        ] }] },
      });
    }
    return new Response("rota inesperada", { status: 404 });
  }));
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const conectar = () =>
  prisma.credential.create({ data: { issuer: "btg", company: s.companies.pixel.id, token: "renova-1", secrets: JSON.stringify({ accessToken: "acesso-velho", accessExp: 0, cnpj: CNPJ }) } });
const sincronizar = (json: Record<string, unknown>) => syncBtg.POST(req("/api/sync/btg", { method: "POST", json: { from: "2026-10-01", ...json } }));
const linhas = () => prisma.transaction.findMany({ where: { accountId: contaBtg.id }, orderBy: { reference: "asc" } });

describe("conectar o BTG (Authorization Code)", () => {
  it("abre o login do BTG com o app, os escopos, prompt=login e state no cookie; membro = 403", async () => {
    loginAs(s.users.root);
    const res = await btgAuth.GET(new Request(`https://finance.exemplo.com/api/btg/auth?companyId=${s.companies.pixel.id}`));
    const destino = new URL(res.headers.get("location")!);
    expect(destino.origin + destino.pathname).toBe(`${ID}/oauth2/authorize`);
    expect(Object.fromEntries(destino.searchParams)).toMatchObject({ client_id: "cliente-teste", response_type: "code", redirect_uri: "https://finance.exemplo.com/api/btg/callback", prompt: "login" });
    expect(destino.searchParams.get("scope")).toContain("brn:btg:empresas:banking:accounts:statement.readonly");
    expect(res.headers.get("set-cookie")).toContain(`cr_btg=${encodeURIComponent(destino.searchParams.get("state")!)}`);
    loginAs(s.users.pixel);
    expect((await btgAuth.GET(new Request(`https://finance.exemplo.com/api/btg/auth?companyId=${s.companies.pixel.id}`))).status).toBe(403);
  });

  it("empresa sem CNPJ = 400; BTG sem Client ID/Secret no servidor = 503", async () => {
    loginAs(s.users.root);
    expect((await btgAuth.GET(new Request(`https://x/api/btg/auth?companyId=${s.companies.outro.id}`))).status).toBe(400);
    vi.stubEnv("BTG_CLIENT_SECRET", "");
    expect((await btgAuth.GET(new Request(`https://x/api/btg/auth?companyId=${s.companies.pixel.id}`))).status).toBe(503);
  });

  it("callback: state tem que bater com o cookie; troca o code com Basic e grava a conexão da empresa", async () => {
    loginAs(s.users.root);
    const state = `${s.companies.pixel.id}:abc123`;
    const sem = await btgCallback.GET(new NextRequest(`https://finance.exemplo.com/api/btg/callback?code=c1&state=${state}`));
    expect(sem.status).toBe(400);
    expect(chamadas).toEqual([]);

    const ok = await btgCallback.GET(new NextRequest(`https://finance.exemplo.com/api/btg/callback?code=c1&state=${encodeURIComponent(state)}`, { headers: { cookie: `cr_btg=${encodeURIComponent(state)}` } }));
    expect(ok.status).toBe(200);
    const token = chamadas.find((c) => c.url === `${ID}/oauth2/token`)!;
    expect(token.auth).toBe(`Basic ${Buffer.from("cliente-teste:segredo-teste").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(token.corpo))).toEqual({ grant_type: "authorization_code", code: "c1", redirect_uri: "https://finance.exemplo.com/api/btg/callback" });
    const cred = await prisma.credential.findUniqueOrThrow({ where: { issuer_company: { issuer: "btg", company: s.companies.pixel.id } } });
    expect(cred.token).toBe("renova-1");
    expect(JSON.parse(cred.secrets!)).toMatchObject({ accessToken: "acesso-novo", cnpj: CNPJ });
  });
});

describe("sync da conta BTG", () => {
  it("renova o token vencido, segue a paginação e grava: débito negativo, crédito positivo, cobrança Meta com código", async () => {
    await conectar();
    loginAs(s.users.pixel);
    const res = await sincronizar({ accountId: contaBtg.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 3, fetched: 3, skipped: 0 });
    // renovou com o refresh token e usou o token NOVO no extrato
    expect(chamadas.some((c) => c.url === `${ID}/oauth2/token` && c.corpo.includes("grant_type=refresh_token"))).toBe(true);
    const extrato = chamadas.find((c) => c.url.includes("/statements"))!;
    expect(extrato.auth).toBe("Bearer acesso-renovado");
    expect(Object.fromEntries(new URL(extrato.url).searchParams)).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-24", type: "simple", pageSize: "1000" });

    const r = await linhas();
    expect(r.map((t) => [t.reference, t.amount, t.currency])).toEqual([
      [`btg:${CONTA_BTG}:1`, -1234.56, "BRL"],
      [`btg:${CONTA_BTG}:2`, -30, "BRL"],
      [`btg:${CONTA_BTG}:3`, 5000, "BRL"],
    ]);
    expect(r[0]).toMatchObject({ description: "Compra no cartão — FACEBK *ABCD1234XY", isMetaCharge: true, metaRef: "ABCD1234XY", operationId: s.operations.pixel.id });
    expect(r[1]).toMatchObject({ isMetaCharge: false, metaRef: null });
    // lembrou a conta do BTG e marcou até quando está sincronizada
    expect(await prisma.account.findUniqueOrThrow({ where: { id: contaBtg.id } })).toMatchObject({ syncConfig: JSON.stringify({ btgAccountId: CONTA_BTG }) });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: contaBtg.id } })).syncedThrough).not.toBeNull();
  });

  it("rodar de novo não duplica nada", async () => {
    await conectar();
    loginAs(s.users.pixel);
    await sincronizar({ accountId: contaBtg.id });
    expect(await (await sincronizar({ accountId: contaBtg.id })).json()).toMatchObject({ imported: 0, skipped: 3 });
    expect(await linhas()).toHaveLength(3);
  });

  it("empresa com mais de uma conta no BTG e nenhuma escolhida = 400 com a lista; escolhendo, sincroniza", async () => {
    contasNoBtg = [...contasNoBtg, { accountId: `${CNPJ}-208-1-999`, number: "999", branchCode: "1" }];
    await conectar();
    loginAs(s.users.pixel);
    const sem = await sincronizar({ accountId: contaBtg.id });
    expect(sem.status).toBe(400);
    expect((await sem.json()).contas).toHaveLength(2);
    expect((await sincronizar({ accountId: contaBtg.id, btgAccountId: CONTA_BTG })).status).toBe(200);
  });

  it("BTG não conectado = 401 needsAuth; conta de outro grupo = 404 sem chamar o BTG", async () => {
    loginAs(s.users.pixel);
    const res = await sincronizar({ accountId: contaBtg.id });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ needsAuth: true });
    chamadas = [];
    loginAs(s.users.outro);
    expect((await sincronizar({ accountId: contaBtg.id })).status).toBe(404);
    expect(chamadas).toEqual([]);
  });

  it("nunca segue um _links.next pra fora da API do BTG (o token não vaza)", async () => {
    await conectar();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/statements")) return Response.json({ _links: { next: "https://atacante.exemplo.com/roubar?x=1" }, data: { dailyMovements: [] } });
      return (original as typeof fetch)(input, init);
    }));
    loginAs(s.users.pixel);
    const res = await sincronizar({ accountId: contaBtg.id, btgAccountId: CONTA_BTG });
    expect(res.status).toBe(502);
    expect(chamadas.some((c) => c.url.includes("atacante"))).toBe(false);
  });

  it("o 'Sincronizar tudo' também sincroniza a conta BTG configurada", async () => {
    await conectar();
    await prisma.account.update({ where: { id: contaBtg.id }, data: { syncConfig: JSON.stringify({ btgAccountId: CONTA_BTG }) } });
    loginAs(s.users.root);
    const r = await (await syncAll.POST(req("/api/sync/all", { method: "POST", json: { from: "2026-10-01", accountId: contaBtg.id } }))).json();
    expect(JSON.stringify(r)).toContain('"bank":"btg"');
    expect(await linhas()).toHaveLength(3);
  });
});
