import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as users from "@/app/api/users/route";
import * as userById from "@/app/api/users/[id]/route";
import * as acesso from "@/app/api/users/acesso-cloudflare/route";
import { sincronizarAcessoCloudflare } from "@/lib/cloudflareAccess";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Lista de acesso da Cloudflare = usuários ATIVOS do sistema (pedido do dono em 2026-10-16: "tem que
 * colocar um User novo na cloudflare toda vez que eu criar um novo no sistema?"). A Cloudflare aqui é
 * uma política em memória: GET devolve, PUT substitui — nada sai da máquina.
 */
const URL_POLITICA = "https://api.cloudflare.com/client/v4/accounts/conta-teste/access/policies/politica-teste";

let politica: Record<string, unknown>;
let puts: Array<Record<string, unknown>>;
let chamadas: string[];
let cloudflareFora: boolean;
let s: Awaited<ReturnType<typeof seedTwoGroups>>;

const emailsNaPolitica = () =>
  (politica.include as Array<{ email?: { email: string } }>).filter((r) => r.email).map((r) => r.email!.email).sort();
const ativosNoBanco = async () =>
  (await prisma.user.findMany({ where: { isActive: true }, select: { email: true } })).map((u) => u.email).sort();

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  vi.stubEnv("CF_ACCESS_API_TOKEN", "token-teste");
  vi.stubEnv("CF_ACCOUNT_ID", "conta-teste");
  vi.stubEnv("CF_ACCESS_POLICY_ID", "politica-teste");
  // a política como está na Cloudflare: 1 regra de grupo (não é e-mail — tem que sobreviver) + os e-mails de hoje
  politica = {
    id: "politica-teste", name: "Equipe PixelFinance", decision: "allow", session_duration: "24h", reusable: true,
    include: [{ group: { id: "grupo-x" } }, ...(await ativosNoBanco()).map((email) => ({ email: { email } }))],
    exclude: [], require: [],
  };
  puts = [];
  chamadas = [];
  cloudflareFora = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url !== URL_POLITICA) return new Response("rota inesperada", { status: 404 });
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer token-teste") return Response.json({ success: false, errors: [{ message: "token" }] }, { status: 403 });
    if (cloudflareFora) return Response.json({ success: false, errors: [{ message: "Cloudflare indisponível" }] }, { status: 500 });
    if (init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body));
      puts.push(corpo);
      politica = { ...politica, ...corpo };
      return Response.json({ success: true, result: politica });
    }
    return Response.json({ success: true, result: politica });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const criar = (email: string, extra: Record<string, unknown> = {}) =>
  users.POST(req("/api/users", { method: "POST", json: { email, role: "member", ...extra } })).then((r) => r.json());
const patch = (id: string, json: unknown) => userById.PATCH(req(`/api/users/${id}`, { method: "PATCH", json }), params({ id })).then((r) => r.json());
const apagar = (id: string) => userById.DELETE(req(`/api/users/${id}`, { method: "DELETE" }), params({ id })).then((r) => r.json());

describe("usuário novo / desativado / reativado / removido → lista da Cloudflare acompanha", () => {
  it("criar inclui o e-mail (minúsculo); desativar tira; reativar põe de volta; remover tira", async () => {
    loginAs(s.users.root);
    const criado = await criar("Nova.Pessoa@Teste.com");
    expect(criado.cloudflare).toEqual({ status: "atualizado", incluidos: ["nova.pessoa@teste.com"], removidos: [] });
    expect(emailsNaPolitica()).toEqual(await ativosNoBanco());
    expect(emailsNaPolitica()).toContain("nova.pessoa@teste.com");

    expect((await patch(criado.id, { isActive: false })).cloudflare).toEqual({ status: "atualizado", incluidos: [], removidos: ["nova.pessoa@teste.com"] });
    expect(emailsNaPolitica()).not.toContain("nova.pessoa@teste.com");

    expect((await patch(criado.id, { isActive: true })).cloudflare.status).toBe("atualizado");
    expect(emailsNaPolitica()).toContain("nova.pessoa@teste.com");

    expect((await apagar(criado.id)).cloudflare).toEqual({ status: "atualizado", incluidos: [], removidos: ["nova.pessoa@teste.com"] });
    expect(emailsNaPolitica()).toEqual(await ativosNoBanco());
  });

  it("só mexe nas regras de e-mail: a regra de grupo e os outros campos da política voltam iguais", async () => {
    loginAs(s.users.root);
    await criar("x@teste.com");
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ name: "Equipe PixelFinance", decision: "allow", session_duration: "24h" });
    expect(puts[0].include).toContainEqual({ group: { id: "grupo-x" } });
  });

  it("mudar papel ou vínculos NÃO chama a Cloudflare (não muda quem entra)", async () => {
    loginAs(s.users.root);
    const r = await patch(s.users.pixel.id, { role: "admin", holdingIds: [s.holdings.pixel.id] });
    expect(r).toEqual({ ok: true });
    expect(chamadas).toEqual([]);
  });

  it("lista já igual = só lê, não grava", async () => {
    loginAs(s.users.root);
    await patch(s.users.pixel.id, { isActive: true }); // já era ativo
    expect(chamadas).toEqual([`GET ${URL_POLITICA}`]);
    expect(puts).toHaveLength(0);
  });

  it("admin de grupo criando alguém também atualiza a lista (ela vem do banco, não do pedido)", async () => {
    const admin = await prisma.user.create({ data: { email: "adm@teste.com", role: "admin" } });
    await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
    politica.include = [...(politica.include as unknown[]), { email: { email: "adm@teste.com" } }];
    loginAs(admin);
    const r = await criar("da-equipe@teste.com", { holdingIds: [s.holdings.pixel.id] });
    expect(r.cloudflare.status).toBe("atualizado");
    expect(emailsNaPolitica()).toEqual(await ativosNoBanco());
  });
});

describe("falhas e travas", () => {
  it("Cloudflare fora do ar: o usuário é criado mesmo assim e a resposta avisa; o 'Sincronizar agora' acerta depois", async () => {
    loginAs(s.users.root);
    cloudflareFora = true;
    const r = await criar("depois@teste.com");
    expect(r.ok).toBe(true);
    expect(r.cloudflare).toEqual({ status: "erro", erro: "Cloudflare (ler a política): Cloudflare indisponível" });
    expect(await prisma.user.findUnique({ where: { email: "depois@teste.com" } })).not.toBeNull();
    expect(emailsNaPolitica()).not.toContain("depois@teste.com");

    // a tela confere ao abrir...
    cloudflareFora = false;
    expect(await (await acesso.GET()).json()).toEqual({ status: "divergente", incluir: ["depois@teste.com"], remover: [] });
    expect(puts).toHaveLength(0); // conferir não grava
    // ...e o botão acerta
    expect((await (await acesso.POST()).json()).status).toBe("atualizado");
    expect(emailsNaPolitica()).toEqual(await ativosNoBanco());
    expect(await (await acesso.GET()).json()).toMatchObject({ status: "em_dia" });
  });

  it("e-mail que alguém pôs à mão na Cloudflare e não é usuário ativo = sai na próxima sincronização", async () => {
    loginAs(s.users.root);
    politica.include = [...(politica.include as unknown[]), { email: { email: "intruso@fora.com" } }];
    expect(await (await acesso.GET()).json()).toEqual({ status: "divergente", incluir: [], remover: ["intruso@fora.com"] });
    await acesso.POST();
    expect(emailsNaPolitica()).not.toContain("intruso@fora.com");
  });

  it("nunca esvazia a lista (trancaria todo mundo do lado de fora)", async () => {
    // só dá pra chegar aqui mexendo no banco (ninguém ativo = ninguém logado pra chamar a rota)
    await prisma.user.updateMany({ data: { isActive: false } });
    expect(await sincronizarAcessoCloudflare()).toEqual({ status: "erro", erro: "nenhum usuário ativo — a lista da Cloudflare não foi esvaziada" });
    expect(chamadas).toEqual([]);
  });

  it("sem configuração no servidor = desligado: não chama a Cloudflare e o usuário é criado", async () => {
    vi.stubEnv("CF_ACCESS_API_TOKEN", "");
    loginAs(s.users.root);
    const r = await criar("sem-cf@teste.com");
    expect(r).toMatchObject({ ok: true, cloudflare: { status: "desligado" } });
    expect(chamadas).toEqual([]);
  });

  it("conferir/sincronizar: só administradores; membro = 403 e deslogado = 401, sem chamar a Cloudflare", async () => {
    loginAs(s.users.pixel);
    expect((await acesso.GET()).status).toBe(403);
    expect((await acesso.POST()).status).toBe(403);
    loginAs(null);
    expect((await acesso.POST()).status).toBe(401);
    expect(chamadas).toEqual([]);
  });
});
