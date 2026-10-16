import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as documentsRoute from "@/app/api/documents/route";
import * as uploadRoute from "@/app/api/documents/upload/route";
import * as documentRoute from "@/app/api/documents/[id]/route";
import * as settingsRoute from "@/app/api/documents/settings/route";
import * as typesRoute from "@/app/api/document-types/route";
import * as typeRoute from "@/app/api/document-types/[id]/route";
import * as companyRoute from "@/app/api/companies/[id]/route";
import { addDays, today } from "@/lib/documents";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

const R2 = { R2_ACCOUNT_ID: "conta123", R2_BUCKET: "pixelfinance-arquivos", R2_ACCESS_KEY_ID: "AKID", R2_SECRET_ACCESS_KEY: "SECRET" };
const ligarR2 = () => Object.entries(R2).forEach(([k, v]) => vi.stubEnv(k, v));

// R2 de mentira: só a rede é trocada (a assinatura e a conferência são o código real).
let r2Calls: { method: string; url: string }[];
let headResponse: () => Response;
function stubR2Network() {
  r2Calls = [];
  headResponse = () => new Response(null, { status: 200, headers: { "content-length": "2048", "content-type": "application/pdf" } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(input, init);
    r2Calls.push({ method: r.method, url: r.url });
    if (r.method === "HEAD") return headResponse();
    if (r.method === "DELETE") return new Response(null, { status: 204 });
    return new Response("inesperado", { status: 500 });
  }));
}

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let adminPixel: { id: string; role: string; email: string };
let adminOutro: { id: string; role: string; email: string };
let certidao: { id: string };
let contrato: { id: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  adminPixel = await prisma.user.create({ data: { email: "admin-pixel@teste.com", role: "admin" } });
  adminOutro = await prisma.user.create({ data: { email: "admin-outro@teste.com", role: "admin" } });
  await prisma.membership.create({ data: { userId: adminPixel.id, holdingId: s.holdings.pixel.id } });
  await prisma.membership.create({ data: { userId: adminOutro.id, holdingId: s.holdings.outro.id } });
  certidao = await prisma.documentType.create({ data: { name: "Certidão" } });
  contrato = await prisma.documentType.create({ data: { name: "Contrato social" } });
  ligarR2();
  stubR2Network();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const startUpload = (json: unknown) => uploadRoute.POST(req("/api/documents/upload", { method: "POST", json }));
const create = (json: unknown) => documentsRoute.POST(req("/api/documents", { method: "POST", json }));
const list = (qs = "") => documentsRoute.GET(req(`/api/documents${qs}`));
const patch = (id: string, json: unknown) => documentRoute.PATCH(req(`/api/documents/${id}`, { method: "PATCH", json }), params({ id }));
const del = (id: string) => documentRoute.DELETE(req(`/api/documents/${id}`, { method: "DELETE" }), params({ id }));
const open = (id: string) => documentRoute.GET(req(`/api/documents/${id}`), params({ id }));
const pdf = { filename: "certidao.pdf", contentType: "application/pdf", size: 2048 };

/** Documento da empresa direto no banco (para testar lista/status sem passar pelo upload). */
let seq = 0;
function seedDoc(companyId: string, expiresAt: string | null, extra: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.document.create({
    data: {
      companyId, typeId: certidao.id, filename: `d${seq}.pdf`, path: `r2:co/${companyId}/2026/10/u${seq}-d.pdf`,
      expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00.000Z`) : null, ...extra,
    },
  });
}

describe("passo 1 — POST /api/documents/upload", () => {
  it("membro do grupo recebe a URL assinada; a chave leva a empresa (montada pelo servidor)", async () => {
    loginAs(s.users.pixel);
    const res = await startUpload({ companyId: s.companies.pixel.id, ...pdf });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.startsWith(`co/${s.companies.pixel.id}/`)).toBe(true);
    expect(new URL(body.uploadUrl).host).toBe("conta123.r2.cloudflarestorage.com");
  });

  it("anexo de transação: a chave leva a transação", async () => {
    loginAs(s.users.pixel);
    const body = await (await startUpload({ transactionId: s.transactions.pixel.id, ...pdf })).json();
    expect(body.key.startsWith(`tx/${s.transactions.pixel.id}/`)).toBe(true);
  });

  it("outro grupo = 404; deslogado = 401", async () => {
    loginAs(s.users.outro);
    expect((await startUpload({ companyId: s.companies.pixel.id, ...pdf })).status).toBe(404);
    expect((await startUpload({ transactionId: s.transactions.pixel.id, ...pdf })).status).toBe(404);
    loginAs(null);
    expect((await startUpload({ companyId: s.companies.pixel.id, ...pdf })).status).toBe(401);
  });

  it("dono ambíguo = 400; tipo proibido = 415; grande demais = 413; sem R2 = 503", async () => {
    loginAs(s.users.pixel);
    expect((await startUpload({ ...pdf })).status).toBe(400);
    expect((await startUpload({ companyId: s.companies.pixel.id, transactionId: s.transactions.pixel.id, ...pdf })).status).toBe(400);
    expect((await startUpload({ companyId: s.companies.pixel.id, ...pdf, contentType: "application/x-msdownload" })).status).toBe(415);
    expect((await startUpload({ companyId: s.companies.pixel.id, ...pdf, size: 26 * 1024 * 1024 })).status).toBe(413);
    vi.unstubAllEnvs();
    expect((await startUpload({ companyId: s.companies.pixel.id, ...pdf })).status).toBe(503);
  });
});

describe("passo 2 — POST /api/documents (registra depois de conferir no R2)", () => {
  const key = (companyId: string) => `co/${companyId}/2026/10/abc-certidao.pdf`;

  it("membro registra documento da empresa; não devolve o caminho interno; guarda quem subiu", async () => {
    loginAs(s.users.pixel);
    const res = await create({ companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "certidao.pdf", typeId: certidao.id, title: "CND federal", issuedAt: "2026-10-01", expiresAt: "2027-03-30" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.path).toBeUndefined();
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
    expect(doc).toMatchObject({ companyId: s.companies.pixel.id, uploadedById: s.users.pixel.id, mimetype: "application/pdf", size: 2048, path: `r2:${key(s.companies.pixel.id)}` });
    expect(r2Calls.map((c) => c.method)).toEqual(["HEAD"]);
  });

  it("arquivo que não chegou ao R2 = 400 e nada registrado", async () => {
    headResponse = () => new Response(null, { status: 404 });
    loginAs(s.users.pixel);
    expect((await create({ companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "x.pdf", typeId: certidao.id })).status).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });

  it("chave de outro dono = 400 (não dá pra registrar arquivo de outra empresa/transação)", async () => {
    loginAs(s.users.pixel);
    expect((await create({ companyId: s.companies.pixel.id, key: key(s.companies.outro.id), filename: "x.pdf", typeId: certidao.id })).status).toBe(400);
    expect((await create({ companyId: s.companies.pixel.id, key: `tx/${s.transactions.pixel.id}/2026/10/a.pdf`, filename: "x.pdf", typeId: certidao.id })).status).toBe(400);
    expect((await create({ companyId: s.companies.pixel.id, key: `co/${s.companies.pixel.id}/../x.pdf`, filename: "x.pdf", typeId: certidao.id })).status).toBe(400);
    expect(r2Calls).toHaveLength(0);
  });

  it("empresa de outro grupo = 404", async () => {
    loginAs(s.users.outro);
    expect((await create({ companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "x.pdf", typeId: certidao.id })).status).toBe(404);
  });

  it("validação: tipo obrigatório e existente, datas AAAA-MM-DD, vencimento depois da emissão", async () => {
    loginAs(s.users.pixel);
    const base = { companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "x.pdf" };
    expect((await create({ ...base })).status).toBe(400);
    expect((await create({ ...base, typeId: "nao-existe" })).status).toBe(400);
    expect((await create({ ...base, typeId: certidao.id, expiresAt: "30/03/2027" })).status).toBe(400);
    expect((await create({ ...base, typeId: certidao.id, expiresAt: "2027-02-30" })).status).toBe(400);
    expect((await create({ ...base, typeId: certidao.id, issuedAt: "2026-10-10", expiresAt: "2026-10-01" })).status).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });

  it("tipo proibido no R2 = 415, e o arquivo é apagado de lá", async () => {
    headResponse = () => new Response(null, { status: 200, headers: { "content-length": "10", "content-type": "text/html" } });
    loginAs(s.users.pixel);
    expect((await create({ companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "x.pdf", typeId: certidao.id })).status).toBe(415);
    expect(r2Calls.map((c) => c.method)).toEqual(["HEAD", "DELETE"]);
    expect(await prisma.document.count()).toBe(0);
  });

  it("a mesma chave duas vezes = 409", async () => {
    loginAs(s.users.pixel);
    const body = { companyId: s.companies.pixel.id, key: key(s.companies.pixel.id), filename: "x.pdf", typeId: certidao.id };
    expect((await create(body)).status).toBe(201);
    expect((await create(body)).status).toBe(409);
  });

  it("anexo de transação: registra; campos de documento da empresa = 400; outro grupo = 404", async () => {
    loginAs(s.users.pixel);
    const k = `tx/${s.transactions.pixel.id}/2026/10/abc-nota.pdf`;
    expect((await create({ transactionId: s.transactions.pixel.id, key: k, filename: "nota.pdf", expiresAt: "2027-01-01" })).status).toBe(400);
    const res = await create({ transactionId: s.transactions.pixel.id, key: k, filename: "nota.pdf" });
    expect(res.status).toBe(201);
    expect(await prisma.document.count({ where: { transactionId: s.transactions.pixel.id } })).toBe(1);
    loginAs(s.users.outro);
    expect((await create({ transactionId: s.transactions.pixel.id, key: `tx/${s.transactions.pixel.id}/2026/10/z.pdf`, filename: "z.pdf" })).status).toBe(404);
  });
});

describe("renovação", () => {
  it("o novo substitui o antigo, que vai pro histórico; renovar o antigo de novo = 409", async () => {
    const antigo = await seedDoc(s.companies.pixel.id, addDays(today(), 5));
    loginAs(s.users.pixel);
    const novo = { companyId: s.companies.pixel.id, key: `co/${s.companies.pixel.id}/2026/10/novo.pdf`, filename: "novo.pdf", typeId: certidao.id, expiresAt: addDays(today(), 180), replacesId: antigo.id };
    expect((await create(novo)).status).toBe(201);

    const atuais = (await (await list()).json()).documents;
    expect(atuais.map((d: { filename: string }) => d.filename)).toEqual(["novo.pdf"]);
    const todos = (await (await list("?historico=1")).json()).documents;
    expect(todos.find((d: { id: string }) => d.id === antigo.id).status).toBe("substituido");

    const outraVez = { ...novo, key: `co/${s.companies.pixel.id}/2026/10/outra.pdf` };
    expect((await create(outraVez)).status).toBe(409);
  });

  it("não renova documento de outra empresa (400) nem de outro grupo (404)", async () => {
    const daOutra = await seedDoc(s.companies.outro.id, null);
    const cPixel2 = await prisma.company.create({ data: { name: "Pixel 2", holdingId: s.holdings.pixel.id } });
    const daPixel2 = await seedDoc(cPixel2.id, null);
    loginAs(s.users.pixel);
    const base = { companyId: s.companies.pixel.id, key: `co/${s.companies.pixel.id}/2026/10/r.pdf`, filename: "r.pdf", typeId: certidao.id };
    expect((await create({ ...base, replacesId: daOutra.id })).status).toBe(404);
    expect((await create({ ...base, replacesId: daPixel2.id })).status).toBe(400);
  });
});

describe("GET /api/documents — lista e status de validade", () => {
  it("status pelo prazo de aviso (30 dias por padrão); vale até o dia do vencimento", async () => {
    const hoje = today();
    const casos: [string | null, string][] = [
      [addDays(hoje, -1), "vencido"],
      [hoje, "vencendo"],
      [addDays(hoje, 30), "vencendo"],
      [addDays(hoje, 31), "vigente"],
      [null, "sem_validade"],
    ];
    const ids: Record<string, string> = {};
    for (const [exp, status] of casos) ids[(await seedDoc(s.companies.pixel.id, exp)).id] = status;
    loginAs(s.users.pixel);
    const body = await (await list()).json();
    expect(body.warnDays).toBe(30);
    for (const d of body.documents) expect(d.status).toBe(ids[d.id]);
    expect(body.documents.map((d: { status: string }) => d.status)).toEqual(["vencido", "vencendo", "vencendo", "vigente", "sem_validade"]);

    const alerta = (await (await list("?status=alerta")).json()).documents;
    expect(alerta.map((d: { status: string }) => d.status).sort()).toEqual(["vencendo", "vencendo", "vencido"]);
    expect((await list("?status=qualquer")).status).toBe(400);
  });

  it("mudar a antecedência muda a classificação", async () => {
    const d = await seedDoc(s.companies.pixel.id, addDays(today(), 10));
    loginAs(adminPixel);
    expect((await settingsRoute.PUT(req("/api/documents/settings", { method: "PUT", json: { expiryWarningDays: 5 } }))).status).toBe(200);
    const body = await (await list()).json();
    expect(body.warnDays).toBe(5);
    expect(body.documents.find((x: { id: string }) => x.id === d.id).status).toBe("vigente");
  });

  it("escopo: cada grupo vê só os seus; superadmin vê todos; anexos de transação não entram", async () => {
    await seedDoc(s.companies.pixel.id, null);
    await seedDoc(s.companies.outro.id, null);
    await prisma.document.create({ data: { transactionId: s.transactions.pixel.id, filename: "nota.pdf", path: "r2:tx/x/nota.pdf" } });
    loginAs(s.users.pixel);
    const pixel = (await (await list()).json()).documents;
    expect(pixel.map((d: { company: { id: string } }) => d.company.id)).toEqual([s.companies.pixel.id]);
    loginAs(s.users.outro);
    expect((await (await list(`?companyId=${s.companies.pixel.id}`)).json()).documents).toHaveLength(0);
    loginAs(s.users.root);
    expect((await (await list()).json()).documents).toHaveLength(2);
    loginAs(null);
    expect((await list()).status).toBe(401);
  });

  it("download de documento da empresa: dono 302, outro grupo 404", async () => {
    const d = await seedDoc(s.companies.pixel.id, null);
    loginAs(s.users.pixel);
    expect((await open(d.id)).status).toBe(302);
    loginAs(s.users.outro);
    expect((await open(d.id)).status).toBe(404);
  });
});

describe("PATCH e DELETE /api/documents/[id]", () => {
  it("membro do grupo corrige título e vencimento; outro grupo 404; anexo de transação 400", async () => {
    const d = await seedDoc(s.companies.pixel.id, null);
    loginAs(s.users.pixel);
    expect((await patch(d.id, { title: "CND estadual", expiresAt: "2027-01-31" })).status).toBe(200);
    const salvo = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(salvo.title).toBe("CND estadual");
    expect(salvo.expiresAt?.toISOString().slice(0, 10)).toBe("2027-01-31");
    expect((await patch(d.id, { issuedAt: "2027-02-01" })).status).toBe(400); // emissão depois do vencimento
    loginAs(s.users.outro);
    expect((await patch(d.id, { title: "invadido" })).status).toBe(404);
    const anexo = await prisma.document.create({ data: { transactionId: s.transactions.pixel.id, filename: "n.pdf", path: "r2:tx/y/n.pdf" } });
    loginAs(s.users.pixel);
    expect((await patch(anexo.id, { title: "x" })).status).toBe(400);
  });

  it("só admin apaga: membro 403; admin do grupo 204 (apaga no R2 e no banco); admin de outro grupo 404", async () => {
    const d = await seedDoc(s.companies.pixel.id, null);
    loginAs(s.users.pixel);
    expect((await del(d.id)).status).toBe(403);
    loginAs(adminOutro);
    expect((await del(d.id)).status).toBe(404);
    expect(r2Calls).toHaveLength(0);
    loginAs(adminPixel);
    expect((await del(d.id)).status).toBe(204);
    expect(r2Calls.map((c) => c.method)).toEqual(["DELETE"]);
    expect(await prisma.document.count({ where: { id: d.id } })).toBe(0);
  });

  it("sem armazenamento não apaga nada (503)", async () => {
    const d = await seedDoc(s.companies.pixel.id, null);
    vi.unstubAllEnvs();
    loginAs(adminPixel);
    expect((await del(d.id)).status).toBe(503);
    expect(await prisma.document.count({ where: { id: d.id } })).toBe(1);
  });

  it("apagar a versão nova devolve a antiga para 'atual'", async () => {
    const antigo = await seedDoc(s.companies.pixel.id, null);
    const novo = await seedDoc(s.companies.pixel.id, null, { replacesId: antigo.id });
    loginAs(adminPixel);
    expect((await del(novo.id)).status).toBe(204);
    const atuais = (await (await list()).json()).documents;
    expect(atuais.map((d: { id: string }) => d.id)).toEqual([antigo.id]);
  });
});

describe("configuração: antecedência e tipos (só admins mudam)", () => {
  const putDays = (v: unknown) => settingsRoute.PUT(req("/api/documents/settings", { method: "PUT", json: { expiryWarningDays: v } }));

  it("antecedência: membro 403; admin muda; valor fora de 0–365 = 400", async () => {
    loginAs(s.users.pixel);
    expect((await putDays(45)).status).toBe(403);
    expect((await (await settingsRoute.GET()).json()).expiryWarningDays).toBe(30);
    loginAs(adminPixel);
    expect((await putDays(400)).status).toBe(400);
    expect((await putDays(2.5)).status).toBe(400);
    expect((await putDays(45)).status).toBe(200);
    expect((await (await settingsRoute.GET()).json()).expiryWarningDays).toBe(45);
  });

  it("tipos: membro não cria; admin cria; nome repetido 409; em uso não apaga (409); sem uso apaga", async () => {
    const post = (name: unknown) => typesRoute.POST(req("/api/document-types", { method: "POST", json: { name } }));
    const put = (id: string, name: string) => typeRoute.PUT(req(`/api/document-types/${id}`, { method: "PUT", json: { name } }), params({ id }));
    const remove = (id: string) => typeRoute.DELETE(req(`/api/document-types/${id}`, { method: "DELETE" }), params({ id }));

    loginAs(s.users.pixel);
    expect((await post("Alvará")).status).toBe(403);
    const lista = await (await typesRoute.GET()).json();
    expect(lista.map((t: { name: string }) => t.name)).toEqual(["Certidão", "Contrato social"]);

    loginAs(adminPixel);
    expect((await post("  ")).status).toBe(400);
    const alvara = await (await post("Alvará")).json();
    expect((await post("Alvará")).status).toBe(409);
    expect((await put(alvara.id, "Certidão")).status).toBe(409);
    expect((await put(alvara.id, "Alvará/licença")).status).toBe(200);

    await seedDoc(s.companies.pixel.id, null, { typeId: contrato.id });
    expect((await remove(contrato.id)).status).toBe(409);
    expect((await remove(alvara.id)).status).toBe(204);
    expect((await remove("nao-existe")).status).toBe(404);
  });
});

describe("regras no próprio banco (valem mesmo se uma rota errar)", () => {
  it("exatamente um dono; documento da empresa tem tipo", async () => {
    const base = { filename: "x.pdf" };
    await expect(prisma.document.create({ data: { ...base, path: "r2:a" } })).rejects.toThrow();
    await expect(prisma.document.create({ data: { ...base, path: "r2:b", transactionId: s.transactions.pixel.id, companyId: s.companies.pixel.id, typeId: certidao.id } })).rejects.toThrow();
    await expect(prisma.document.create({ data: { ...base, path: "r2:c", companyId: s.companies.pixel.id } })).rejects.toThrow();
    expect(await prisma.document.count()).toBe(0);
  });

  it("empresa com documentos não é apagada (409)", async () => {
    await seedDoc(s.companies.pixel.id, null);
    loginAs(s.users.pixel);
    const res = await companyRoute.DELETE(req(`/api/companies/${s.companies.pixel.id}`, { method: "DELETE" }), params({ id: s.companies.pixel.id }));
    expect(res.status).toBe(409);
  });
});
