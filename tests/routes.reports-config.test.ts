import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as dashboard from "@/app/api/dashboard/route";
import * as analytics from "@/app/api/analytics/route";
import * as chartsData from "@/app/api/charts/data/route";
import * as pl from "@/app/api/pl/route";
import * as checagem from "@/app/api/checagem/route";
import * as fechamento from "@/app/api/fechamento/route";
import * as cobrancasMeta from "@/app/api/cobrancas-meta/route";
import * as planValues from "@/app/api/plan/values/route";
import * as categories from "@/app/api/categories/route";
import * as category from "@/app/api/categories/[id]/route";
import * as charts from "@/app/api/charts/route";
import * as chart from "@/app/api/charts/[id]/route";
import * as chartSeries from "@/app/api/charts/series/route";
import * as planSeries from "@/app/api/plan/series/route";
import * as planSeriesOne from "@/app/api/plan/series/[id]/route";
import * as exchangeRates from "@/app/api/exchange-rates/route";
import * as exchangeRatesFetch from "@/app/api/exchange-rates/fetch/route";
import * as syncPeriod from "@/app/api/settings/sync-period/route";
import * as coverage from "@/app/api/coverage/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Relatórios (números financeiros) só somam o que é do grupo de quem pede; configuração global
 * (categorias, gráficos, plano, câmbio, período de sync, cobertura) só o administrador geral altera.
 *
 * Dados (outubro/2026), além do seedTwoGroups:
 *  - Pixel: "Pagamento Pixel" -100 USD (Meta, categoria Receita) + "Entrada Pixel" +50 USD sem categoria
 *  - Outro: "Pagamento Outro" -200 USD (Meta, categoria Receita) + "Entrada Outro" +70 BRL sem categoria
 *  - Cobranças Meta: c-px (Op Pixel, act 111, $10) e c-ot (Op Outro, act 222, $20); `outro` é membro da Op Outro
 */

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let f: Awaited<ReturnType<typeof seedReports>>;

/** Tabelas de configuração/relatório que o wipe() do helpers não limpa. */
async function wipeConfig() {
  await prisma.chartSeriesLink.deleteMany();
  await prisma.dashboardChartLine.deleteMany();
  await prisma.dashboardChart.deleteMany();
  await prisma.planSeriesValue.deleteMany();
  await prisma.planSeries.deleteMany();
  await prisma.category.deleteMany({ where: { parentId: { not: null } } });
  await prisma.category.deleteMany();
  await prisma.exchangeRate.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.metaBillingCharge.deleteMany();
  await prisma.metaAdAccount.deleteMany();
  await prisma.metaReceipt.deleteMany();
}

async function seedReports(seed: Awaited<ReturnType<typeof seedTwoGroups>>) {
  const { accounts, transactions, holdings, users, operations } = seed;
  await prisma.setting.create({ data: { key: "sync.from", value: "2026-01-01" } });
  await prisma.setting.create({ data: { key: "sync.to", value: "2026-12-31" } });

  const opOutro = await prisma.operation.create({ data: { name: "Op Outro", holdingId: holdings.outro.id } });
  await prisma.operationMembership.create({ data: { userId: users.outro.id, operationId: opOutro.id } });

  const receita = await prisma.category.create({ data: { type: "MANAGERIAL", name: "Receita" } });
  await prisma.transaction.update({ where: { id: transactions.pixel.id }, data: { isMetaCharge: true } });
  await prisma.transaction.update({ where: { id: transactions.outro.id }, data: { isMetaCharge: true } });
  await prisma.transactionSplit.create({ data: { transactionId: transactions.pixel.id, amount: -100, managerialCategoryId: receita.id } });
  await prisma.transactionSplit.create({ data: { transactionId: transactions.outro.id, amount: -200, managerialCategoryId: receita.id } });
  await prisma.transaction.create({
    data: { accountId: accounts.pixel.id, date: new Date("2026-10-05"), description: "Entrada Pixel", amount: 50, currency: "USD", reference: "px-2" },
  });
  await prisma.transaction.create({
    data: { accountId: accounts.outro.id, date: new Date("2026-10-05"), description: "Entrada Outro", amount: 70, currency: "BRL", reference: "ot-2" },
  });

  // gráfico "Resultado" = Receita; série-fórmula "Resultado + Zero" usa o GRÁFICO como operando
  const resultado = await prisma.dashboardChart.create({
    data: { name: "Resultado", lines: { create: [{ categoryId: receita.id, factor: 1 }] } },
  });
  const zero = await prisma.planSeries.create({ data: { name: "Zero", values: { create: [{ month: "2026-10", value: 0 }] } } });
  const formula = await prisma.planSeries.create({
    data: { name: "Resultado + Zero", formulaOp: "+", formulaChartAId: resultado.id, formulaSeriesBId: zero.id, order: 1 },
  });
  await prisma.chartSeriesLink.create({ data: { chartId: resultado.id, seriesId: formula.id } });

  await prisma.metaAdAccount.create({ data: { accountId: "111", name: "Act Pixel", operationId: operations.pixel.id } });
  await prisma.metaAdAccount.create({ data: { accountId: "222", name: "Act Outro", operationId: opOutro.id } });
  await prisma.metaBillingCharge.create({
    data: { transactionId: "c-px", accountId: "111", operationId: operations.pixel.id, amountUsd: 10, currency: "USD", chargedAt: new Date("2026-10-02") },
  });
  await prisma.metaBillingCharge.create({
    data: { transactionId: "c-ot", accountId: "222", operationId: opOutro.id, amountUsd: 20, currency: "USD", chargedAt: new Date("2026-10-02") },
  });

  return { receita, resultado, zero, formula, opOutro };
}

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups(); // apaga transações/splits antes → dá pra apagar categorias depois
  await wipeConfig();
  f = await seedReports(s);
});

type U = { id: string; role: string } | null;
/** Chama o handler como `user` e devolve { status, body }. */
async function call(user: U, fn: () => Promise<Response>) {
  loginAs(user);
  const res = await fn();
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ───────────────────────── números financeiros ─────────────────────────

describe("/api/dashboard", () => {
  const get = (q = "?year=2026") => () => dashboard.GET(req(`/api/dashboard${q}`));

  it("membro só soma o próprio grupo; superadmin soma os dois; sem vínculo não vê nada", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(pixel.body.managerialByMonth).toEqual({ "2026-10": { Receita: -100 } });
    expect(Object.keys(pixel.body.byAccount)).toEqual([s.accounts.pixel.id]);
    expect(pixel.body.byAccount[s.accounts.pixel.id]).toMatchObject({ inflow: 50, outflow: 100 });

    const operador = await call(s.users.operador, get());
    expect(operador.body.managerialByMonth).toEqual({ "2026-10": { Receita: -100 } });

    const outro = await call(s.users.outro, get());
    expect(outro.body.managerialByMonth).toEqual({ "2026-10": { Receita: -200 } });
    expect(Object.keys(outro.body.byAccount)).toEqual([s.accounts.outro.id]);

    const root = await call(s.users.root, get());
    expect(root.body.managerialByMonth).toEqual({ "2026-10": { Receita: -300 } });
    expect(Object.keys(root.body.byAccount).sort()).toEqual([s.accounts.pixel.id, s.accounts.outro.id].sort());

    const sem = await call(s.users.semAcesso, get());
    expect(sem.body.managerialByMonth).toEqual({});
    expect(sem.body.byAccount).toEqual({});
  });

  it("empresa de outro grupo = 404; a própria filtra; deslogado = 401", async () => {
    expect((await call(s.users.pixel, get(`?year=2026&companyId=${s.companies.outro.id}`))).status).toBe(404);
    const own = await call(s.users.pixel, get(`?year=2026&companyId=${s.companies.pixel.id}`));
    expect(own.body.managerialByMonth).toEqual({ "2026-10": { Receita: -100 } });
    expect((await call(null, get())).status).toBe(401);
  });
});

describe("/api/analytics", () => {
  const get = () => () => analytics.GET(req(`/api/analytics?categoryId=${f.receita.id}&from=2026-10&to=2026-10`));

  it("linhas só do próprio grupo; superadmin vê as duas; deslogado = 401", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.body.rows.map((r: { name: string }) => r.name)).toEqual(["Pagamento Pixel"]);
    expect(pixel.body.rows[0].total).toBe(100);
    const root = await call(s.users.root, get());
    expect(root.body.rows.map((r: { name: string }) => r.name)).toEqual(["Pagamento Outro", "Pagamento Pixel"]);
    expect((await call(null, get())).status).toBe(401);
  });
});

describe("/api/charts/data", () => {
  const get = (q = "") => () => chartsData.GET(req(`/api/charts/data?from=2026-10&to=2026-10${q}`));

  it("a linha do gráfico E a série-fórmula que usa o gráfico só somam o próprio grupo", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(pixel.body.charts[0].series).toEqual([{ month: "2026-10", value: -100 }]);
    expect(pixel.body.charts[0].targets[0].series).toEqual([{ month: "2026-10", value: -100 }]);

    const root = await call(s.users.root, get());
    expect(root.body.charts[0].series).toEqual([{ month: "2026-10", value: -300 }]);
    expect(root.body.charts[0].targets[0].series).toEqual([{ month: "2026-10", value: -300 }]);
  });

  it("empresa de outro grupo = 404; deslogado = 401", async () => {
    expect((await call(s.users.pixel, get(`&companyId=${s.companies.outro.id}`))).status).toBe(404);
    expect((await call(null, get())).status).toBe(401);
  });
});

describe("/api/plan/values", () => {
  const get = () => () => planValues.GET(req("/api/plan/values?from=2026-10&to=2026-10"));
  const formulaValues = (body: Array<{ id: string; values: unknown[] }>) => body.find((x) => x.id === f.formula.id)?.values;

  it("série-fórmula com gráfico como operando só soma o próprio grupo", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(formulaValues(pixel.body)).toEqual([{ id: `${f.formula.id}:2026-10`, seriesId: f.formula.id, month: "2026-10", value: -100 }]);
    const root = await call(s.users.root, get());
    expect(formulaValues(root.body)).toEqual([{ id: `${f.formula.id}:2026-10`, seriesId: f.formula.id, month: "2026-10", value: -300 }]);
    expect((await call(null, get())).status).toBe(401);
  });

  it("gravar valores do plano: membro = 403 sem mudar nada; superadmin grava", async () => {
    const post = () => planValues.POST(req("/api/plan/values", { method: "POST", json: { values: [{ seriesId: f.zero.id, month: "2026-10", value: 999 }] } }));
    expect((await call(s.users.pixel, post)).status).toBe(403);
    const value = () => prisma.planSeriesValue.findUnique({ where: { seriesId_month: { seriesId: f.zero.id, month: "2026-10" } } });
    expect((await value())?.value).toBe(0);
    expect((await call(s.users.root, post)).status).toBe(200);
    expect((await value())?.value).toBe(999);
  });
});

describe("/api/pl", () => {
  const get = (q = "") => () => pl.GET(req(`/api/pl?from=2026-10&to=2026-10${q}`));

  it("categorias e 'sem categoria' só do próprio grupo; superadmin soma os dois", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(pixel.body.rows.map((r: { id: string; total: number }) => [r.id, r.total])).toEqual([[f.receita.id, -100]]);
    expect(pixel.body.uncategorizedRow).toMatchObject({ total: 50, count: 1 });

    const operador = await call(s.users.operador, get());
    expect(operador.body.rows[0].total).toBe(-100);
    expect(operador.body.uncategorizedRow.total).toBe(50);

    const outro = await call(s.users.outro, get());
    expect(outro.body.rows[0].total).toBe(-200);
    expect(outro.body.uncategorizedRow.total).toBe(70);

    const root = await call(s.users.root, get());
    expect(root.body.rows[0].total).toBe(-300);
    expect(root.body.uncategorizedRow).toMatchObject({ total: 120, count: 2 });

    const sem = await call(s.users.semAcesso, get());
    expect(sem.body.rows).toEqual([]);
    expect(sem.body.uncategorizedRow).toBeNull();
  });

  it("filtro de empresa/holding/operação fora do escopo = 404; o próprio filtra; deslogado = 401", async () => {
    expect((await call(s.users.pixel, get(`&companyId=${s.companies.outro.id}`))).status).toBe(404);
    expect((await call(s.users.pixel, get(`&holdingId=${s.holdings.outro.id}`))).status).toBe(404);
    expect((await call(s.users.pixel, get(`&operationId=${f.opOutro.id}`))).status).toBe(404);
    const own = await call(s.users.pixel, get(`&holdingId=${s.holdings.pixel.id}`));
    expect(own.status).toBe(200);
    expect(own.body.rows[0].total).toBe(-100);
    expect((await call(null, get())).status).toBe(401);
  });
});

describe("/api/checagem", () => {
  const get = (q = "") => () => checagem.GET(req(`/api/checagem${q}`));

  it("cobranças Meta, empresas e contas só do próprio grupo; superadmin vê as duas", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(pixel.body.vazamento.total.semCodigo).toEqual({ qtde: 1, usd: 100 });
    expect(pixel.body.companies.map((c: { id: string }) => c.id)).toEqual([s.companies.pixel.id]);
    expect(pixel.body.accounts.map((a: { id: string }) => a.id)).toEqual([s.accounts.pixel.id]);

    const root = await call(s.users.root, get());
    expect(root.body.vazamento.total.semCodigo).toEqual({ qtde: 2, usd: 300 });
    expect(root.body.companies).toHaveLength(2);
  });

  it("empresa/conta de outro grupo = 404 (antes vazava, até deslogado); a própria filtra; deslogado = 401", async () => {
    expect((await call(s.users.pixel, get(`?company=${s.companies.outro.id}`))).status).toBe(404);
    expect((await call(s.users.pixel, get(`?account=${s.accounts.outro.id}`))).status).toBe(404);
    expect((await call(s.users.pixel, get(`?account=${s.accounts.pixel.id}`))).body.vazamento.total.semCodigo.qtde).toBe(1);
    expect((await call(null, get(`?company=${s.companies.outro.id}`))).status).toBe(401);
  });
});

describe("/api/fechamento", () => {
  const get = (q = "") => () => fechamento.GET(req(`/api/fechamento?month=2026-10${q}`));

  it("contagens só do próprio grupo; cobranças Meta seguem a operação; superadmin vê tudo", async () => {
    const pixel = await call(s.users.pixel, get());
    expect(pixel.status).toBe(200);
    expect(pixel.body.passos.bancos.transacoesMeta).toBe(1);
    expect(pixel.body.passos.meta.cobrancas).toBe(0); // membro da holding, não da operação (regra de antes)
    expect(pixel.body.companies.map((c: { id: string }) => c.id)).toEqual([s.companies.pixel.id]);

    const operador = await call(s.users.operador, get());
    expect(operador.body.passos.bancos.transacoesMeta).toBe(1);
    expect(operador.body.passos.meta.cobrancas).toBe(1);

    const root = await call(s.users.root, get());
    expect(root.body.passos.bancos.transacoesMeta).toBe(2);
    expect(root.body.passos.meta.cobrancas).toBe(2);
  });

  it("meses do seletor: do 1º mês com cobrança Meta até o mês atual, mesmo com o período de análise travado em junho", async () => {
    await prisma.setting.upsert({ where: { key: "sync.from" }, update: { value: "2026-06-01" }, create: { key: "sync.from", value: "2026-06-01" } });
    await prisma.setting.upsert({ where: { key: "sync.to" }, update: { value: "2026-06-30" }, create: { key: "sync.to", value: "2026-06-30" } });
    await prisma.transaction.create({
      data: { accountId: s.accounts.pixel.id, date: new Date("2026-05-20"), description: "FACEBK *antiga", amount: -10, currency: "USD", reference: "px-antiga", isMetaCharge: true },
    });
    const body = (await call(s.users.pixel, () => fechamento.GET(req("/api/fechamento")))).body;
    const atual = new Date().toISOString().slice(0, 7);
    expect(body.mesesDisponiveis[0]).toBe(atual);
    expect(body.mesesDisponiveis.at(-1)).toBe("2026-05");
    expect(body.mesesDisponiveis).toContain("2026-07");
    expect(body.month).toBe(atual);
  });

  it("empresa de outro grupo = 404; deslogado = 401", async () => {
    expect((await call(s.users.pixel, get(`&company=${s.companies.outro.id}`))).status).toBe(404);
    expect((await call(s.users.pixel, get(`&company=${s.companies.pixel.id}`))).body.passos.bancos.transacoesMeta).toBe(1);
    expect((await call(null, get())).status).toBe(401);
  });
});

describe("/api/cobrancas-meta", () => {
  const get = (q = "") => () => cobrancasMeta.GET(req(`/api/cobrancas-meta${q}`));
  const ids = (body: { rows: Array<{ transactionId: string }> }) => body.rows.map((r) => r.transactionId).sort();

  it("cada um vê só as cobranças das operações dele; superadmin vê todas", async () => {
    const operador = await call(s.users.operador, get());
    expect(operador.status).toBe(200);
    expect(ids(operador.body)).toEqual(["c-px"]);
    expect(operador.body.kpis.totalUsd).toBe(10);
    expect(operador.body.contas.map((c: { accountId: string }) => c.accountId)).toEqual(["111"]);

    expect(ids((await call(s.users.outro, get())).body)).toEqual(["c-ot"]);
    expect(ids((await call(s.users.pixel, get())).body)).toEqual([]); // sem operação = sem cobrança (regra de antes)

    const root = await call(s.users.root, get());
    expect(ids(root.body)).toEqual(["c-ot", "c-px"]);
    expect(root.body.kpis.totalUsd).toBe(30);
  });

  it("filtrar por conta de anúncio de outro grupo não traz nada; deslogado = 401", async () => {
    const r = await call(s.users.operador, get("?account=222"));
    expect(r.body.rows).toEqual([]);
    expect(r.body.kpis.totalUsd).toBe(0);
    expect((await call(null, get())).status).toBe(401);
  });
});

// ───────────────────────── configuração global ─────────────────────────

describe("/api/categories", () => {
  it("membro lê; deslogado = 401", async () => {
    const r = await call(s.users.pixel, () => categories.GET(req("/api/categories")));
    expect(r.status).toBe(200);
    expect(r.body.map((c: { id: string }) => c.id)).toContain(f.receita.id);
    expect((await call(null, () => categories.GET(req("/api/categories")))).status).toBe(401);
  });

  it("membro não cria, não edita, não apaga (403, banco intacto); superadmin pode", async () => {
    const id = f.receita.id;
    const post = () => categories.POST(req("/api/categories", { method: "POST", json: { type: "MANAGERIAL", name: "Nova" } }));
    const put = () => category.PUT(req(`/api/categories/${id}`, { method: "PUT", json: { name: "hack", color: "#000000" } }), params({ id }));
    const del = (cid: string) => () => category.DELETE(req(`/api/categories/${cid}`, { method: "DELETE" }), params({ id: cid }));

    expect((await call(s.users.pixel, post)).status).toBe(403);
    expect((await call(s.users.pixel, put)).status).toBe(403);
    expect((await call(s.users.pixel, del(id))).status).toBe(403);
    expect(await prisma.category.count()).toBe(1);
    expect((await prisma.category.findUnique({ where: { id } }))?.name).toBe("Receita");

    const created = await call(s.users.root, post);
    expect(created.status).toBe(201);
    expect((await call(s.users.root, put)).status).toBe(200);
    expect((await prisma.category.findUnique({ where: { id } }))?.name).toBe("hack");
    expect((await call(s.users.root, del(created.body.id))).status).toBe(204);
  });
});

describe("/api/charts", () => {
  it("membro lê; não cria, não reordena, não edita, não apaga (403, banco intacto); superadmin pode", async () => {
    const id = f.resultado.id;
    expect((await call(s.users.pixel, () => charts.GET())).body.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await call(null, () => charts.GET())).status).toBe(401);

    const post = () => charts.POST(req("/api/charts", { method: "POST", json: { name: "Novo", lines: [{ categoryId: f.receita.id, factor: -1 }] } }));
    const patch = () => charts.PATCH(req("/api/charts", { method: "PATCH", json: { ids: [id] } }));
    const put = () => chart.PUT(req(`/api/charts/${id}`, { method: "PUT", json: { name: "hack", lines: [] } }), params({ id }));
    const del = (cid: string) => () => chart.DELETE(req(`/api/charts/${cid}`, { method: "DELETE" }), params({ id: cid }));

    for (const fn of [post, patch, put, del(id)]) expect((await call(s.users.pixel, fn)).status).toBe(403);
    const intact = await prisma.dashboardChart.findMany({ include: { lines: true } });
    expect(intact).toHaveLength(1);
    expect(intact[0].name).toBe("Resultado");
    expect(intact[0].lines).toHaveLength(1);

    const created = await call(s.users.root, post);
    expect(created.status).toBe(201);
    expect((await call(s.users.root, patch)).status).toBe(200);
    expect((await call(s.users.root, put)).status).toBe(200);
    expect((await prisma.dashboardChart.findUnique({ where: { id } }))?.name).toBe("hack");
    expect((await call(s.users.root, del(created.body.id))).status).toBe(200);
  });
});

describe("/api/charts/series", () => {
  it("membro não vincula, não altera, não desvincula (403, banco intacto); superadmin pode", async () => {
    const link = { chartId: f.resultado.id, seriesId: f.zero.id };
    const existing = { chartId: f.resultado.id, seriesId: f.formula.id };
    const post = () => chartSeries.POST(req("/api/charts/series", { method: "POST", json: link }));
    const patch = () => chartSeries.PATCH(req("/api/charts/series", { method: "PATCH", json: { ...existing, yAxis: "right" } }));
    const del = () => chartSeries.DELETE(req("/api/charts/series", { method: "DELETE", json: existing }));

    for (const fn of [post, patch, del]) expect((await call(s.users.pixel, fn)).status).toBe(403);
    const links = await prisma.chartSeriesLink.findMany();
    expect(links).toHaveLength(1);
    expect(links[0].yAxis).toBe("left");

    expect((await call(s.users.root, post)).status).toBe(201);
    expect((await call(s.users.root, patch)).status).toBe(200);
    expect((await call(s.users.root, del)).status).toBe(200);
    expect((await prisma.chartSeriesLink.findMany()).map((l) => l.seriesId)).toEqual([f.zero.id]);
  });
});

describe("/api/plan/series", () => {
  it("membro lê; não cria, não edita, não apaga (403, banco intacto); superadmin pode", async () => {
    const id = f.zero.id;
    expect((await call(s.users.pixel, () => planSeries.GET())).body).toHaveLength(2);
    expect((await call(null, () => planSeries.GET())).status).toBe(401);

    const post = () => planSeries.POST(req("/api/plan/series", { method: "POST", json: { name: "Meta" } }));
    const put = () => planSeriesOne.PUT(req(`/api/plan/series/${id}`, { method: "PUT", json: { name: "hack" } }), params({ id }));
    const del = (sid: string) => () => planSeriesOne.DELETE(req(`/api/plan/series/${sid}`, { method: "DELETE" }), params({ id: sid }));

    for (const fn of [post, put, del(id)]) expect((await call(s.users.pixel, fn)).status).toBe(403);
    expect(await prisma.planSeries.count()).toBe(2);
    expect((await prisma.planSeries.findUnique({ where: { id } }))?.name).toBe("Zero");

    const created = await call(s.users.root, post);
    expect(created.status).toBe(201);
    expect((await call(s.users.root, put)).status).toBe(200);
    expect((await prisma.planSeries.findUnique({ where: { id } }))?.name).toBe("hack");
    expect((await call(s.users.root, del(created.body.id))).status).toBe(200);
  });
});

describe("/api/exchange-rates", () => {
  it("membro lê; a lista de moedas em uso só olha o próprio grupo", async () => {
    expect((await call(s.users.pixel, () => exchangeRates.GET())).body.currencies).toEqual([]);
    expect((await call(s.users.outro, () => exchangeRates.GET())).body.currencies).toEqual(["BRL"]);
    expect((await call(s.users.root, () => exchangeRates.GET())).body.currencies).toEqual(["BRL"]);
    expect((await call(null, () => exchangeRates.GET())).status).toBe(401);
  });

  it("gravar câmbio: membro = 403 sem gravar; superadmin grava", async () => {
    const post = () => exchangeRates.POST(req("/api/exchange-rates", { method: "POST", json: { rates: [{ currency: "BRL", month: "2026-10", rateToUsd: 0.2 }] } }));
    expect((await call(s.users.pixel, post)).status).toBe(403);
    expect(await prisma.exchangeRate.count()).toBe(0);
    expect((await call(s.users.root, post)).status).toBe(200);
    expect((await prisma.exchangeRate.findFirst())?.rateToUsd).toBe(0.2);
  });
});

describe("/api/exchange-rates/fetch", () => {
  const savedKey = process.env.WISE_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.WISE_API_KEY;
    else process.env.WISE_API_KEY = savedKey;
  });

  it("membro = 403 sem chamar a Wise nem gravar; superadmin busca e grava (Wise simulada)", async () => {
    const wise = vi.fn(async () => new Response(JSON.stringify([{ rate: 0.19 }]), { status: 200 }));
    vi.stubGlobal("fetch", wise);
    process.env.WISE_API_KEY = "chave-de-teste";
    const post = () => exchangeRatesFetch.POST(req("/api/exchange-rates/fetch", { method: "POST", json: { currencies: ["BRL"], from: "2026-10", to: "2026-10" } }));

    expect((await call(s.users.pixel, post)).status).toBe(403);
    expect(wise).not.toHaveBeenCalled();
    expect(await prisma.exchangeRate.count()).toBe(0);

    const root = await call(s.users.root, post);
    expect(root.status).toBe(200);
    expect(root.body.fetched).toBe(1);
    expect(wise).toHaveBeenCalledTimes(1);
    expect((await prisma.exchangeRate.findFirst())?.rateToUsd).toBe(0.19);
  });
});

describe("/api/settings/sync-period", () => {
  it("membro lê; membro não altera (403, banco intacto); superadmin altera; deslogado = 401", async () => {
    const get = await call(s.users.pixel, () => syncPeriod.GET());
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect((await call(null, () => syncPeriod.GET())).status).toBe(401);

    const post = () => syncPeriod.POST(req("/api/settings/sync-period", { method: "POST", json: { from: "2025-01-01" } }));
    expect((await call(s.users.pixel, post)).status).toBe(403);
    expect((await prisma.setting.findUnique({ where: { key: "sync.from" } }))?.value).toBe("2026-01-01");

    const root = await call(s.users.root, post);
    expect(root.status).toBe(200);
    expect(root.body).toEqual({ from: "2025-01-01", to: null });
  });
});

describe("/api/coverage (Control)", () => {
  it("member não vê (403, papel lido do banco: cookie forjado com role=superadmin não passa); deslogado = 401", async () => {
    expect((await call(s.users.pixel, () => coverage.GET())).status).toBe(403);
    expect((await call({ id: s.users.pixel.id, role: "superadmin" }, () => coverage.GET())).status).toBe(403);
    expect((await call(null, () => coverage.GET())).status).toBe(401);
  });

  it("superadmin vê todas as empresas; admin vê só as do grupo dele, com as transações dele", async () => {
    const root = await call(s.users.root, () => coverage.GET());
    expect(root.status).toBe(200);
    expect(root.body.companies).toHaveLength(2);

    const adminPixel = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", passwordHash: "x:y" } });
    await prisma.membership.create({ data: { userId: adminPixel.id, holdingId: s.holdings.pixel.id } });
    const px = await call(adminPixel, () => coverage.GET());
    expect(px.status).toBe(200);
    expect(px.body.companies.map((c: { id: string }) => c.id)).toEqual([s.companies.pixel.id]);
    expect(px.body.accounts.map((a: { id: string }) => a.id)).toEqual([s.accounts.pixel.id]);
    const mes = Object.keys(px.body.matrix[s.companies.pixel.id]).find((m) => px.body.matrix[s.companies.pixel.id][m] > 0);
    expect(mes).toBe("2026-10");
    expect(JSON.stringify(px.body)).not.toContain(s.companies.outro.id);
  });
});
