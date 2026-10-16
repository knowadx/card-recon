import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as list from "@/app/api/transactions/route";
import * as ids from "@/app/api/transactions/ids/route";
import { loginAs, req, seedTwoGroups } from "./helpers";

let s: Awaited<ReturnType<typeof seedTwoGroups>>;

beforeAll(async () => {
  s = await seedTwoGroups();
  const acc = s.accounts.pixel.id;
  const mk = (ref: string, description: string, amount: number, extra: Record<string, unknown> = {}) =>
    prisma.transaction.create({ data: { accountId: acc, date: new Date("2026-10-05"), description, amount, currency: "USD", reference: ref, ...extra } });
  await mk("m1", "Facebk anuncio A", -50, { isMetaCharge: true, hasReceipt: true });
  await mk("m2", "Facebk anuncio B", -500, { isMetaCharge: true, hasReceipt: false });
  await mk("m3", "Facebk anuncio C", -5000, { isMetaCharge: true, hasReceipt: false });
  await mk("x1", "Aluguel escritorio", -500);
  await mk("x2", "Recebimento cliente", 500);
  await mk("x3", "Tarifa ignorada", -1, { ignored: true });
});

async function idsFromList(qs: string): Promise<string[]> {
  const res = await list.GET(req(`/api/transactions?take=1000&${qs}`));
  const body = await res.json();
  return body.data.map((t: { id: string }) => t.id).sort();
}
async function idsFromSelectAll(qs: string): Promise<string[]> {
  const body = await (await ids.GET(req(`/api/transactions/ids?${qs}`))).json();
  return [...body.ids].sort();
}
async function descriptions(qs: string): Promise<string[]> {
  const body = await (await list.GET(req(`/api/transactions?take=1000&${qs}`))).json();
  return body.data.map((t: { description: string }) => t.description).sort();
}

describe("lista e 'selecionar todas' usam os mesmos filtros", () => {
  const combos = [
    "",
    "colFatura=sem",
    "colFatura=com",
    "colFatura=meta",
    "search=Facebk&colAmountMin=400",
    "colDirection=out&colAmountMax=600",
    "showIgnored=true",
    "onlyIgnored=true",
    `companyId=${"__x__"}`,
  ];
  for (const qs of combos) {
    it(`mesmo conjunto: "${qs || "(sem filtro)"}"`, async () => {
      loginAs(s.users.pixel);
      expect(await idsFromSelectAll(qs)).toEqual(await idsFromList(qs));
    });
  }
});

describe("cada filtro vale junto com os outros (antes um sobrescrevia o outro)", () => {
  it("'Possui Fatura = sem' traz só Meta sem PDF — inclusive no selecionar todas", async () => {
    loginAs(s.users.pixel);
    expect(await descriptions("colFatura=sem")).toEqual(["Facebk anuncio B", "Facebk anuncio C"]);
    expect((await idsFromSelectAll("colFatura=sem")).length).toBe(2);
  });

  it("busca + faixa de valor: as duas valem (antes a faixa apagava a busca)", async () => {
    loginAs(s.users.pixel);
    // valor absoluto entre 400 e 600 E descrição com "Facebk" → só o anúncio B
    expect(await descriptions("search=Facebk&colAmountMin=400&colAmountMax=600")).toEqual(["Facebk anuncio B"]);
  });

  it("o escopo continua: o outro grupo não vê nada da Pixel por nenhum filtro", async () => {
    loginAs(s.users.outro);
    expect(await idsFromSelectAll("colFatura=meta")).toEqual([]);
    expect(await descriptions("search=Facebk")).toEqual([]);
  });
});
