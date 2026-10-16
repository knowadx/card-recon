import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import * as transactions from "@/app/api/transactions/route";
import * as transaction from "@/app/api/transactions/[id]/route";
import * as documents from "@/app/api/transactions/[id]/documents/route";
import * as splits from "@/app/api/transactions/[id]/splits/route";
import * as accountingSplits from "@/app/api/transactions/[id]/accounting-splits/route";
import * as bulk from "@/app/api/transactions/bulk/route";
import * as ids from "@/app/api/transactions/ids/route";
import * as importCsv from "@/app/api/transactions/import/route";
import * as importDolafy from "@/app/api/transactions/import/dolafy/route";
import * as importHusky from "@/app/api/transactions/import/husky/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let opOutro: { id: string };
let category: { id: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  opOutro = await prisma.operation.create({ data: { name: "Op Outro", holdingId: s.holdings.outro.id } });
  category = await prisma.category.create({ data: { type: "managerial", name: "Teste" } });
});

// O upload de documento grava em <cwd>/uploads/<id>/ — apaga o que os testes criarem.
const UPLOADS = path.join(process.cwd(), "uploads");
const uploadsExisted = existsSync(UPLOADS);
const uploadDirs = new Set<string>();
afterAll(() => {
  for (const id of uploadDirs) rmSync(path.join(UPLOADS, id), { recursive: true, force: true });
  if (!uploadsExisted && existsSync(UPLOADS) && readdirSync(UPLOADS).length === 0) rmSync(UPLOADS, { recursive: true });
});

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

function formReq(p: string, fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request(`http://localhost${p}`, { method: "POST", body: fd });
}

const csvFile = () =>
  new File(["date,description,amount,reference\n2026-10-05,Importada CSV,-50,imp-1\n"], "extrato.csv", { type: "text/csv" });
const dolafyFile = () =>
  new File(
    ['date,description,amount,status,source amount,source currency\n"Jun 2, 2026, 09:38",Importada Dolafy,-10.00,Completed,10.00,USD\n'],
    "dolafy.csv",
    { type: "text/csv" },
  );
function huskyFile() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Date", "Event", "Payer", "Beneficiary", "Amount"],
    ["Start date", "Initial balance", "", "", ""],
    ["2026-10-05", "Payout", "", "Fulano", "123.45"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new File([new Uint8Array(buf)], "husky.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function txCount(accountId: string) {
  return prisma.transaction.count({ where: { accountId } });
}

describe("GET /api/transactions", () => {
  const list = async (query = "") => transactions.GET(req(`/api/transactions${query}`));

  it("deslogado = 401", async () => {
    loginAs(null);
    expect((await list()).status).toBe(401);
  });

  it("cada grupo vê só as suas; superadmin vê tudo; sem vínculo não vê nada", async () => {
    loginAs(s.users.pixel);
    expect(idsOf((await (await list()).json()).data)).toEqual([s.transactions.pixel.id]);
    loginAs(s.users.outro);
    expect(idsOf((await (await list()).json()).data)).toEqual([s.transactions.outro.id]);
    loginAs(s.users.root);
    expect(idsOf((await (await list()).json()).data)).toEqual(idsOf([s.transactions.pixel, s.transactions.outro]));
    loginAs(s.users.semAcesso);
    const empty = await (await list()).json();
    expect(empty.data).toEqual([]);
    expect(empty.total).toBe(0);
  });

  it("mesma regra de antes: operador vê a conta da operação E a transação marcada na operação dele", async () => {
    await prisma.transaction.update({ where: { id: s.transactions.outro.id }, data: { operationId: s.operations.pixel.id } });
    loginAs(s.users.operador);
    expect(idsOf((await (await list()).json()).data)).toEqual(idsOf([s.transactions.pixel, s.transactions.outro]));
    // a marcação na operação não abre a transação pra holding Pixel (o escopo de holding é pela conta)
    loginAs(s.users.pixel);
    expect(idsOf((await (await list()).json()).data)).toEqual([s.transactions.pixel.id]);
  });

  it("filtro pela conta de outro grupo não fura o escopo (mesmo combinado com busca/valor, que usam OR)", async () => {
    loginAs(s.users.pixel);
    const body = await (await list(`?accountId=${s.accounts.outro.id}&search=Pagamento&colAmountMin=1`)).json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("nunca devolve o token do banco da conta", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "segredo-banco" } });
    loginAs(s.users.pixel);
    const body = await (await list()).json();
    expect(body.data[0].account.company.id).toBe(s.companies.pixel.id);
    expect(JSON.stringify(body)).not.toContain("segredo-banco");
  });
});

describe("POST /api/transactions", () => {
  const create = (json: Record<string, unknown>) => transactions.POST(req("/api/transactions", { method: "POST", json }));
  const base = { date: "2026-10-10", description: "nova", amount: -5, currency: "USD" };

  it("deslogado = 401 e nada é criado", async () => {
    loginAs(null);
    expect((await create({ ...base, accountId: s.accounts.pixel.id })).status).toBe(401);
    expect(await prisma.transaction.count({ where: { description: "nova" } })).toBe(0);
  });

  it("não cria transação em conta de outro grupo, nem sem conta", async () => {
    loginAs(s.users.pixel);
    expect((await create({ ...base, accountId: s.accounts.outro.id })).status).toBe(404);
    expect((await create({ ...base })).status).toBe(404);
    expect(await prisma.transaction.count({ where: { description: "nova" } })).toBe(0);
  });

  it("não aceita operação de outro grupo", async () => {
    loginAs(s.users.pixel);
    expect((await create({ ...base, accountId: s.accounts.pixel.id, operationId: opOutro.id })).status).toBe(404);
    expect(await prisma.transaction.count({ where: { description: "nova" } })).toBe(0);
  });

  it("dono cria na própria conta (sem o token na resposta); superadmin cria em qualquer conta", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "segredo-banco" } });
    loginAs(s.users.pixel);
    const res = await create({ ...base, accountId: s.accounts.pixel.id, operationId: s.operations.pixel.id });
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toContain("segredo-banco");
    loginAs(s.users.root);
    expect((await create({ ...base, accountId: s.accounts.outro.id })).status).toBe(201);
    expect(await prisma.transaction.count({ where: { description: "nova" } })).toBe(2);
  });
});

describe("GET /api/transactions/[id]", () => {
  const get = (id: string) => transaction.GET(req(`/api/transactions/${id}`), params({ id }));

  it("deslogado = 401; outro grupo = 404", async () => {
    loginAs(null);
    expect((await get(s.transactions.pixel.id)).status).toBe(401);
    loginAs(s.users.outro);
    expect((await get(s.transactions.pixel.id)).status).toBe(404);
  });

  it("dono e superadmin leem, sem o token do banco", async () => {
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { apiToken: "segredo-banco" } });
    for (const u of [s.users.pixel, s.users.root]) {
      loginAs(u);
      const res = await get(s.transactions.pixel.id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(s.transactions.pixel.id);
      expect(JSON.stringify(body)).not.toContain("segredo-banco");
    }
  });
});

describe("POST /api/transactions/[id]/documents", () => {
  const upload = (id: string) =>
    documents.POST(formReq(`/api/transactions/${id}/documents`, { file: new File(["a,b\n1,2\n"], "nota.csv", { type: "text/csv" }) }), params({ id }));

  it("deslogado = 401 e outro grupo = 404 — sem documento e sem arquivo gravado", async () => {
    const id = s.transactions.pixel.id;
    uploadDirs.add(id);
    loginAs(null);
    expect((await upload(id)).status).toBe(401);
    loginAs(s.users.outro);
    expect((await upload(id)).status).toBe(404);
    expect(await prisma.document.count({ where: { transactionId: id } })).toBe(0);
    expect(existsSync(path.join(UPLOADS, id))).toBe(false);
  });

  it("dono anexa", async () => {
    const id = s.transactions.pixel.id;
    uploadDirs.add(id);
    loginAs(s.users.pixel);
    expect((await upload(id)).status).toBe(201);
    expect(await prisma.document.count({ where: { transactionId: id } })).toBe(1);
  });
});

describe("/api/transactions/[id]/splits", () => {
  const put = (id: string, body: unknown[]) =>
    splits.PUT(req(`/api/transactions/${id}/splits`, { method: "PUT", json: { splits: body } }), params({ id }));
  const get = (id: string) => splits.GET(req(`/api/transactions/${id}/splits`), params({ id }));

  async function seedSplit() {
    return prisma.transactionSplit.create({ data: { transactionId: s.transactions.pixel.id, amount: -100, note: "original" } });
  }
  async function splitState(id: string) {
    const [rows, tx] = await Promise.all([
      prisma.transactionSplit.findMany({ where: { transactionId: id }, select: { id: true, note: true, operationId: true } }),
      prisma.transaction.findUnique({ where: { id }, select: { operationId: true } }),
    ]);
    return { rows, txOperationId: tx?.operationId };
  }

  it("deslogado = 401; outro grupo = 404 no GET e no PUT, e nada muda", async () => {
    const original = await seedSplit();
    const id = s.transactions.pixel.id;
    const before = await splitState(id);
    loginAs(null);
    expect((await get(id)).status).toBe(401);
    expect((await put(id, [{ amount: -100, note: "hack" }])).status).toBe(401);
    loginAs(s.users.outro);
    expect((await get(id)).status).toBe(404);
    expect((await put(id, [{ amount: -100, note: "hack", operationId: opOutro.id }])).status).toBe(404);
    expect(await splitState(id)).toEqual(before);
    expect(before.rows.map((r) => r.id)).toEqual([original.id]);
  });

  it("dono não grava operação de outro grupo (nem num split do meio) — nada muda", async () => {
    await seedSplit();
    const id = s.transactions.pixel.id;
    const before = await splitState(id);
    loginAs(s.users.pixel);
    const res = await put(id, [
      { amount: -60, operationId: s.operations.pixel.id },
      { amount: -40, operationId: opOutro.id },
    ]);
    expect(res.status).toBe(404);
    expect(await splitState(id)).toEqual(before);
  });

  it("dono lê e regrava com a própria operação; superadmin regrava no outro grupo", async () => {
    await seedSplit();
    const id = s.transactions.pixel.id;
    loginAs(s.users.pixel);
    expect((await get(id)).status).toBe(200);
    const res = await put(id, [{ amount: -100, note: "nova", operationId: s.operations.pixel.id }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
    const after = await splitState(id);
    expect(after.rows.map((r) => r.note)).toEqual(["nova"]);
    expect(after.txOperationId).toBe(s.operations.pixel.id);

    loginAs(s.users.root);
    const outroId = s.transactions.outro.id;
    expect((await put(outroId, [{ amount: -200, operationId: opOutro.id }])).status).toBe(200);
    expect((await splitState(outroId)).txOperationId).toBe(opOutro.id);
  });
});

describe("/api/transactions/[id]/accounting-splits", () => {
  const put = (id: string, body: unknown[]) =>
    accountingSplits.PUT(req(`/api/transactions/${id}/accounting-splits`, { method: "PUT", json: { splits: body } }), params({ id }));
  const get = (id: string) => accountingSplits.GET(req(`/api/transactions/${id}/accounting-splits`), params({ id }));
  const notes = async (id: string) =>
    (await prisma.accountingSplit.findMany({ where: { transactionId: id }, select: { note: true } })).map((r) => r.note);

  it("deslogado = 401; outro grupo = 404 no GET e no PUT, e nada muda", async () => {
    const id = s.transactions.pixel.id;
    await prisma.accountingSplit.create({ data: { transactionId: id, amount: -100, note: "original" } });
    loginAs(null);
    expect((await get(id)).status).toBe(401);
    expect((await put(id, [{ amount: -100, note: "hack" }])).status).toBe(401);
    loginAs(s.users.outro);
    expect((await get(id)).status).toBe(404);
    expect((await put(id, [{ amount: -100, note: "hack" }])).status).toBe(404);
    expect(await notes(id)).toEqual(["original"]);
  });

  it("dono lê e regrava; superadmin regrava no outro grupo", async () => {
    const id = s.transactions.pixel.id;
    loginAs(s.users.pixel);
    expect((await get(id)).status).toBe(200);
    expect((await put(id, [{ amount: -100, note: "nova" }])).status).toBe(200);
    expect(await notes(id)).toEqual(["nova"]);
    loginAs(s.users.root);
    expect((await put(s.transactions.outro.id, [{ amount: -200, note: "root" }])).status).toBe(200);
    expect(await notes(s.transactions.outro.id)).toEqual(["root"]);
  });
});

describe("GET /api/transactions/ids", () => {
  const list = async (query = "") => ids.GET(req(`/api/transactions/ids${query}`));

  it("deslogado = 401", async () => {
    loginAs(null);
    expect((await list()).status).toBe(401);
  });

  it("só ids do escopo — mesmo pedindo a conta do outro grupo", async () => {
    loginAs(s.users.pixel);
    expect((await (await list()).json()).ids).toEqual([s.transactions.pixel.id]);
    expect((await (await list(`?accountId=${s.accounts.outro.id}`)).json()).ids).toEqual([]);
    loginAs(s.users.semAcesso);
    expect((await (await list()).json()).ids).toEqual([]);
    loginAs(s.users.root);
    expect((await (await list()).json()).ids.sort()).toEqual(idsOf([s.transactions.pixel, s.transactions.outro]));
  });
});

describe("/api/transactions/bulk", () => {
  const call = (method: "DELETE" | "PATCH" | "PUT", json: Record<string, unknown>) =>
    bulk[method](req("/api/transactions/bulk", { method, json }));
  const state = async () =>
    Promise.all(
      [s.transactions.pixel.id, s.transactions.outro.id].map(async (id) => {
        const tx = await prisma.transaction.findUnique({ where: { id }, select: { ignored: true } });
        const sp = await prisma.transactionSplit.findMany({ where: { transactionId: id }, select: { managerialCategoryId: true } });
        return { exists: !!tx, ignored: tx?.ignored, splits: sp };
      }),
    );

  it("deslogado = 401 nos três métodos, nada muda", async () => {
    const before = await state();
    loginAs(null);
    const one = [s.transactions.pixel.id];
    expect((await call("DELETE", { ids: one })).status).toBe(401);
    expect((await call("PATCH", { ids: one, ignored: true })).status).toBe(401);
    expect((await call("PUT", { ids: one, managerialCategoryId: category.id })).status).toBe(401);
    expect(await state()).toEqual(before);
  });

  it("lote com 1 id de dentro e 1 de fora = recusa o lote inteiro, nenhuma das duas muda", async () => {
    const before = await state();
    loginAs(s.users.pixel);
    const mixed = [s.transactions.pixel.id, s.transactions.outro.id];
    expect((await call("PATCH", { ids: mixed, ignored: true })).status).toBe(404);
    expect((await call("PUT", { ids: mixed, managerialCategoryId: category.id })).status).toBe(404);
    expect((await call("DELETE", { ids: mixed })).status).toBe(404);
    expect(await state()).toEqual(before);
    expect(before.every((t) => t.exists && t.ignored === false && t.splits.length === 0)).toBe(true);
  });

  it("lote só com id do outro grupo = 404, nada muda", async () => {
    const before = await state();
    loginAs(s.users.pixel);
    const other = [s.transactions.outro.id];
    expect((await call("PATCH", { ids: other, ignored: true })).status).toBe(404);
    expect((await call("PUT", { ids: other, managerialCategoryId: category.id })).status).toBe(404);
    expect((await call("DELETE", { ids: other })).status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it("dono ignora, classifica e apaga as próprias", async () => {
    loginAs(s.users.pixel);
    const own = [s.transactions.pixel.id];
    expect((await call("PATCH", { ids: own, ignored: true })).status).toBe(200);
    expect((await call("PUT", { ids: own, managerialCategoryId: category.id })).status).toBe(200);
    let [px, ot] = await state();
    expect(px).toEqual({ exists: true, ignored: true, splits: [{ managerialCategoryId: category.id }] });
    expect(ot).toEqual({ exists: true, ignored: false, splits: [] });
    expect((await call("DELETE", { ids: own })).status).toBe(200);
    [px, ot] = await state();
    expect(px.exists).toBe(false);
    expect(ot.exists).toBe(true);
  });

  it("superadmin age num lote misturado", async () => {
    loginAs(s.users.root);
    const mixed = [s.transactions.pixel.id, s.transactions.outro.id];
    expect((await call("PATCH", { ids: mixed, ignored: true })).status).toBe(200);
    expect((await state()).map((t) => t.ignored)).toEqual([true, true]);
  });
});

describe("importações (CSV, Dolafy, Husky)", () => {
  const importers = [
    { name: "CSV", handler: importCsv.POST, path: "/api/transactions/import", file: csvFile },
    { name: "Dolafy", handler: importDolafy.POST, path: "/api/transactions/import/dolafy", file: dolafyFile },
    { name: "Husky", handler: importHusky.POST, path: "/api/transactions/import/husky", file: huskyFile },
  ];

  for (const imp of importers) {
    describe(imp.name, () => {
      const send = (accountId: string) => imp.handler(formReq(imp.path, { file: imp.file(), accountId }));

      it("deslogado = 401; conta de outro grupo = 404 — nada gravado", async () => {
        loginAs(null);
        expect((await send(s.accounts.pixel.id)).status).toBe(401);
        loginAs(s.users.pixel);
        const res = await send(s.accounts.outro.id);
        expect(res.status).toBe(404);
        expect(await txCount(s.accounts.outro.id)).toBe(1);
        expect(await txCount(s.accounts.pixel.id)).toBe(1);
      });

      it("dono importa na própria conta; superadmin em qualquer uma", async () => {
        loginAs(s.users.pixel);
        const res = await send(s.accounts.pixel.id);
        expect(res.status).toBe(200);
        expect((await res.json()).imported).toBe(1);
        expect(await txCount(s.accounts.pixel.id)).toBe(2);
        loginAs(s.users.root);
        expect((await send(s.accounts.outro.id)).status).toBe(200);
        expect(await txCount(s.accounts.outro.id)).toBe(2);
      });
    });
  }
});
