import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as metaToken from "@/app/api/meta/token/route";
import * as operations from "@/app/api/operations/route";
import { metaAuthorizeUrl, META_PERMISSOES } from "@/lib/meta";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * "Colar token" da Meta (pedido do dono em 2026-10-16): o login do Facebook do app Business travou em
 * "Recurso indisponível" → conexão por token de USUÁRIO DO SISTEMA, que não passa por aquela tela.
 * A Meta daqui é falsa: debug_token responde conforme o token; nada sai da máquina.
 */
const BOM = "EAAbom" + "x".repeat(60);
const OUTRO_APP = "EAAoutroapp" + "x".repeat(60);
const SEM_PERMISSAO = "EAAsemperm" + "x".repeat(60);
const VENCIDO = "EAAvencido" + "x".repeat(60);

let chamadas: string[];
let s: Awaited<ReturnType<typeof seedTwoGroups>>;

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.credential.deleteMany();
  vi.stubEnv("META_APP_ID", "app-nosso");
  vi.stubEnv("META_APP_SECRET", "segredo");
  chamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    chamadas.push(url.pathname);
    if (url.pathname.endsWith("/debug_token")) {
      const t = url.searchParams.get("input_token");
      const base = { is_valid: true, app_id: "app-nosso", type: "SYSTEM_USER", scopes: [...META_PERMISSOES, "public_profile"], expires_at: 0 };
      const data =
        t === BOM ? base
        : t === OUTRO_APP ? { ...base, app_id: "app-de-outro" }
        : t === SEM_PERMISSAO ? { ...base, scopes: ["ads_read"] }
        : t === VENCIDO ? { is_valid: false, error: { message: "Session has expired" } }
        : { is_valid: false, error: { message: "Invalid OAuth access token" } };
      return Response.json({ data });
    }
    if (url.pathname.endsWith("/me")) return Response.json({ id: "999", name: "PixelFinance (usuário do sistema)" });
    return new Response("rota inesperada", { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const colar = (operationId: string, token: string) =>
  metaToken.POST(req("/api/meta/token", { method: "POST", json: { operationId, token } }));

describe("POST /api/meta/token — conectar a Meta da operação com token colado", () => {
  it("token bom do usuário do sistema: grava a conexão da operação, diz que não vence e NÃO devolve o token", async () => {
    loginAs(s.users.operador);
    const res = await colar(s.operations.pixel.id, `  ${BOM}\n`); // espaços/quebra de linha do copiar-colar
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toEqual({ ok: true, operacao: "Op Pixel", perfil: "PixelFinance (usuário do sistema)", tipo: "SYSTEM_USER", expiraEm: null });
    expect(JSON.stringify(j)).not.toContain(BOM);

    const cred = await prisma.credential.findFirstOrThrow({ where: { issuer: "meta", operationId: s.operations.pixel.id } });
    expect(cred).toMatchObject({ token: BOM, isActive: true, company: "Op Pixel" });
    expect(JSON.parse(cred.secrets!)).toMatchObject({ metaUserName: "PixelFinance (usuário do sistema)", tipo: "SYSTEM_USER", via: "token" });

    // a tela Operações mostra conectado e "por token"
    const op = (await (await operations.GET()).json()).find((o: { id: string }) => o.id === s.operations.pixel.id);
    expect(op).toMatchObject({ metaConnected: true, metaProfile: "PixelFinance (usuário do sistema)", metaVia: "token" });
  });

  it("reconectar troca a credencial da operação (continua UMA por operação) e reativa", async () => {
    await prisma.credential.create({ data: { issuer: "meta", company: "Op Pixel", operationId: s.operations.pixel.id, token: "velho", isActive: false } });
    loginAs(s.users.operador);
    expect((await colar(s.operations.pixel.id, BOM)).status).toBe(200);
    const creds = await prisma.credential.findMany({ where: { issuer: "meta", operationId: s.operations.pixel.id } });
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ token: BOM, isActive: true });
  });

  it.each([
    [OUTRO_APP, 422, "token gerado para outro app (app-de-outro) — gere para o app app-nosso"],
    [SEM_PERMISSAO, 422, "faltam permissões no token: ads_management, business_management"],
    [VENCIDO, 422, "a Meta diz que o token não vale: Session has expired"],
  ])("recusa o que a Meta não confirma (%#) e não grava nada", async (token, status, erro) => {
    loginAs(s.users.operador);
    const res = await colar(s.operations.pixel.id, token);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(erro);
    expect(await prisma.credential.count()).toBe(0);
  });

  it("texto que não é token = 400 sem nem perguntar à Meta", async () => {
    loginAs(s.users.operador);
    const res = await colar(s.operations.pixel.id, "meu token é abc 123");
    expect(res.status).toBe(400);
    expect(chamadas).toEqual([]);
    expect(await prisma.credential.count()).toBe(0);
  });

  it("operação de outro grupo = 403 e deslogado = 401, sem chamar a Meta e sem gravar", async () => {
    loginAs(s.users.outro);
    expect((await colar(s.operations.pixel.id, BOM)).status).toBe(403);
    loginAs(null);
    expect((await colar(s.operations.pixel.id, BOM)).status).toBe(401);
    expect(chamadas).toEqual([]);
    expect(await prisma.credential.count()).toBe(0);
  });

  it("sem o app configurado no servidor: não dá pra conferir = recusa (nunca grava às cegas)", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    loginAs(s.users.operador);
    const res = await colar(s.operations.pixel.id, BOM);
    expect(res.status).toBe(503);
    expect(await prisma.credential.count()).toBe(0);
  });
});

describe("permissões: uma lista só", () => {
  it("o login clássico pede exatamente as META_PERMISSOES", () => {
    vi.stubEnv("META_LOGIN_CONFIG_ID", "");
    expect(new URL(metaAuthorizeUrl("https://x/cb", "st")).searchParams.get("scope")).toBe(META_PERMISSOES.join(","));
  });
});
