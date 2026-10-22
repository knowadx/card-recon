import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as fechamento from "@/app/api/fechamento/route";
import * as cobrancasRota from "@/app/api/fechamento/cobrancas/route";
import { recomputeHasReceipt } from "@/lib/receipts";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Fechamento: resumo por CARTÃO (ok × pendente), transações de cada cartão e exportação
 * (pedido do dono em 2026-10-17). Tudo sai da mesma lista (src/lib/cobrancasMeta.ts).
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.metaReceipt.deleteMany();
  const meta = (accountId: string, ref: string, data: { date: string; amount: number; card: string | null; label?: string; code: string | null; desc?: string; currency?: string }) =>
    prisma.transaction.create({
      data: {
        accountId, reference: ref, date: new Date(data.date), description: data.desc ?? `Facebk *${data.code ?? "?"}`, amount: -data.amount, currency: data.currency ?? "USD",
        isMetaCharge: true, metaRef: data.code, cardLast4: data.card, cardLabel: data.label ?? null,
      },
    });
  // Pixel, cartão 9514: 1 com fatura, 1 sem PDF, 1 sem código
  await meta(s.accounts.pixel.id, "m1", { date: "2026-09-30", amount: 900, card: "9514", label: "BM 21 - 04.05", code: "kkjqg9ncx4" });
  await meta(s.accounts.pixel.id, "m2", { date: "2026-09-29", amount: 721.54, card: "9514", label: "BM 21 - 04.05", code: "ebelw8jcx4" });
  await meta(s.accounts.pixel.id, "m3", { date: "2026-09-28", amount: 1.7, card: "9514", label: "BM 21 - 04.05", code: null, desc: "Meta; pagamento \"BM 21\"" });
  // Pixel, cartão 1482: 1 com fatura
  await meta(s.accounts.pixel.id, "m4", { date: "2026-09-29", amount: 361.66, card: "1482", label: "bm 6 - thetheniv 05", code: "ayzfs8s5g4" });
  // Pixel, sem cartão no extrato: 1 sem PDF
  await meta(s.accounts.pixel.id, "m5", { date: "2026-09-10", amount: 50, card: null, code: "semcartao1" });
  // Pixel, cartão 3333 em EUR: 1 sem PDF (EUR nunca soma com USD)
  await meta(s.accounts.pixel.id, "m7", { date: "2026-09-05", amount: 80, card: "3333", code: "euro000001", currency: "EUR" });
  // fora do mês (não entra)
  await meta(s.accounts.pixel.id, "m6", { date: "2026-08-31", amount: 10, card: "9514", code: "agosto0001" });
  // Outro grupo
  await meta(s.accounts.outro.id, "o1", { date: "2026-09-15", amount: 200, card: "7777", code: "outro00001" });

  // faturas PDF (código em MAIÚSCULA: o casamento não diferencia)
  await prisma.metaReceipt.createMany({
    data: [
      { transactionId: "r1", referenceNumber: "KKJQG9NCX4", accountId: "act_111", accountName: "BM 21 - Conta A" },
      { transactionId: "r4", referenceNumber: "AYZFS8S5G4", accountId: "act_222", accountName: "BM 6 - Conta B" },
      { transactionId: "r9", referenceNumber: "OUTRO00001", accountId: "act_999", accountName: "Conta do outro grupo" },
    ],
  });
  await recomputeHasReceipt();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T12:00:00Z") }); // setembro encerrado
});
afterEach(() => vi.useRealTimers());

const fech = async (q = "month=2026-09") => (await fechamento.GET(req(`/api/fechamento?${q}`))).json();
const lista = (q: string) => cobrancasRota.GET(req(`/api/fechamento/cobrancas?${q}`));

describe("resumo por cartão no Fechamento", () => {
  it("conta ok e pendente (sem PDF / sem código) por cartão, maior VALOR pendente primeiro, e bate com os números do topo", async () => {
    loginAs(s.users.pixel);
    const d = await fech();
    expect(d.cartoes).toEqual([
      expect.objectContaining({ chave: `${s.accounts.pixel.id}:9514`, cartaoFinal: "9514", cartaoNome: "BM 21 - 04.05", conta: "Mercury Pixel", total: 3, ok: 1, semPdf: 1, semCodigo: 1, valorOk: { USD: 900 }, valorPendente: { USD: 723.24 } }),
      expect.objectContaining({ chave: `${s.accounts.pixel.id}:3333`, cartaoFinal: "3333", total: 1, ok: 0, semPdf: 1, valorPendente: { EUR: 80 } }), // 80 > 50, pelo valor de face
      expect.objectContaining({ chave: `${s.accounts.pixel.id}:-`, cartaoFinal: null, total: 1, ok: 0, semPdf: 1, semCodigo: 0, valorOk: {}, valorPendente: { USD: 50 } }),
      expect.objectContaining({ chave: `${s.accounts.pixel.id}:1482`, cartaoFinal: "1482", total: 1, ok: 1, semPdf: 0, semCodigo: 0, valorOk: { USD: 361.66 }, valorPendente: {} }),
    ]);
    // mesma fonte: topo = soma dos cartões, em quantidade e valor; USD e EUR separados
    expect(d.resultado).toEqual({ totalMeta: 6, comFatura: 2, semFatura: 4 });
    expect(d.pendentes).toEqual({ total: 4, semCodigo: 1, codigoSemPdf: 3 });
    expect(d.totais).toEqual({
      total: { qtd: 6, valor: { USD: 2034.9, EUR: 80 } },
      checado: { qtd: 2, valor: { USD: 1261.66 } },
      pendente: { qtd: 4, valor: { USD: 773.24, EUR: 80 } },
      semCodigo: { qtd: 1, valor: { USD: 1.7 } },
      semPdf: { qtd: 3, valor: { USD: 771.54, EUR: 80 } },
    });
  });

  it("ordem é pelo VALOR pendente, não pela quantidade: 1 pendência de 5.000 passa à frente de 2 que somam 723", async () => {
    await prisma.transaction.create({
      data: { accountId: s.accounts.pixel.id, reference: "grande", date: new Date("2026-09-20"), description: "Facebk *grande0001", amount: -5000, currency: "USD", isMetaCharge: true, metaRef: "grande0001", cardLast4: "7000" },
    });
    loginAs(s.users.pixel);
    expect((await fech()).cartoes.map((c: { cartaoFinal: string | null }) => c.cartaoFinal)).toEqual(["7000", "9514", "3333", null, "1482"]);
  });

  it("estorno (entrada) e cobrança ignorada ficam FORA: topo, cartão, lista e exportação", async () => {
    const extra = (ref: string, data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { accountId: s.accounts.pixel.id, reference: ref, date: new Date("2026-09-15"), description: "Facebook", currency: "USD", isMetaCharge: true, cardLast4: "9514", ...data } });
    await extra("estorno", { amount: 300, metaRef: "estorno001" }); // entrada = estorno da Meta
    await extra("ignorada", { amount: -400, metaRef: "ignorada01", ignored: true });
    loginAs(s.users.pixel);
    const d = await fech();
    expect(d.totais.total).toEqual({ qtd: 6, valor: { USD: 2034.9, EUR: 80 } }); // igual ao de antes
    expect(d.cartoes.find((c: { cartaoFinal: string }) => c.cartaoFinal === "9514")).toMatchObject({ total: 3, semPdf: 1 });
    const csv = await (await lista("month=2026-09&formato=csv")).text();
    expect(csv).not.toContain("estorno001");
    expect(csv).not.toContain("ignorada01");
  });

  it("abrir um cartão traz só as transações dele, com situação e a conta de anúncio da fatura", async () => {
    loginAs(s.users.pixel);
    const r = await (await lista(`month=2026-09&cartao=${s.accounts.pixel.id}:9514`)).json();
    expect(r.cobrancas.map((c: { codigo: string | null; situacao: string; contaAnuncio: string | null }) => [c.codigo, c.situacao, c.contaAnuncio])).toEqual([
      ["kkjqg9ncx4", "ok", "act_111"],
      ["ebelw8jcx4", "sem_pdf", null],
      [null, "sem_codigo", null],
    ]);
    // "sem cartão" também abre
    expect((await (await lista(`month=2026-09&cartao=${s.accounts.pixel.id}:-`)).json()).cobrancas.map((c: { codigo: string }) => c.codigo)).toEqual(["semcartao1"]);
  });

  it("exporta CSV pro Excel em português: BOM, ';', vírgula decimal, data dd/mm/aaaa, texto com ; e aspas protegido", async () => {
    loginAs(s.users.pixel);
    const res = await lista("month=2026-09&formato=csv");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="cobrancas-meta-2026-09.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: o Excel abre com acento certo
    const linhas = new TextDecoder().decode(bytes).trimEnd().split("\r\n");
    expect(linhas[0]).toBe("Data;Empresa;Banco;Conta;Cartão (final);Nome do cartão;Descrição;Valor;Moeda;Código Meta;Situação;Conta de anúncio (fatura);Nome da conta de anúncio");
    expect(linhas).toHaveLength(1 + 6); // só setembro, só o grupo dele
    expect(linhas[1]).toBe("30/09/2026;Pixel Ads LLC;Mercury;Mercury Pixel;9514;BM 21 - 04.05;Facebk *kkjqg9ncx4;900,00;USD;kkjqg9ncx4;Com fatura;act_111;BM 21 - Conta A");
    expect(linhas).toContain('28/09/2026;Pixel Ads LLC;Mercury;Mercury Pixel;9514;BM 21 - 04.05;"Meta; pagamento ""BM 21""";1,70;USD;;Sem código;;');
    // exportar só um cartão
    const so1482 = await lista(`month=2026-09&formato=csv&cartao=${s.accounts.pixel.id}:1482`);
    expect(so1482.headers.get("content-disposition")).toBe('attachment; filename="cobrancas-meta-2026-09-cartao-1482.csv"');
    expect((await so1482.text()).trimEnd().split("\r\n")).toHaveLength(2);
  });
});

describe("escopo: ninguém vê cobrança de outro grupo — nem no resumo, nem abrindo cartão, nem exportando", () => {
  it("o outro grupo só vê o próprio cartão; pedir o cartão da Pixel = lista vazia; empresa da Pixel = 404", async () => {
    loginAs(s.users.outro);
    expect((await fech()).cartoes.map((c: { cartaoFinal: string }) => c.cartaoFinal)).toEqual(["7777"]);
    expect((await (await lista(`month=2026-09&cartao=${s.accounts.pixel.id}:9514`)).json()).cobrancas).toEqual([]);
    const csv = await (await lista("month=2026-09&formato=csv")).text();
    expect(csv).toContain("outro00001");
    expect(csv).not.toContain("kkjqg9ncx4");
    expect((await lista(`month=2026-09&company=${s.companies.pixel.id}&formato=csv`)).status).toBe(404);
  });

  it("superadmin vê os dois grupos; filtro de empresa restringe", async () => {
    loginAs(s.users.root);
    expect((await fech()).cartoes).toHaveLength(5);
    expect((await fech(`month=2026-09&company=${s.companies.outro.id}`)).cartoes.map((c: { cartaoFinal: string }) => c.cartaoFinal)).toEqual(["7777"]);
  });

  it("mês inválido = 400; deslogado = 401", async () => {
    loginAs(s.users.pixel);
    expect((await lista("month=setembro")).status).toBe(400);
    loginAs(null);
    expect((await lista("month=2026-09")).status).toBe(401);
  });
});
