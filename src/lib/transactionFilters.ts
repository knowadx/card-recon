import type { Prisma } from "@/generated/prisma/client";

/**
 * Filtros da tela de transações — fonte ÚNICA para a lista (GET /api/transactions) e para o
 * "selecionar todas" (GET /api/transactions/ids). Antes eram duas cópias e a do "selecionar todas"
 * ignorava o filtro "Possui Fatura": com ele ligado, a seleção pegava transações que não estavam na
 * tela (e um apagar em lote apagaria linhas nunca vistas).
 *
 * Cada filtro entra como um item de AND: antes, objetos com a mesma chave se sobrescreviam (a busca
 * sumia quando havia faixa de valor; colCompany apagava companyId; dois "NOT"/"splits" colidiam).
 * O escopo do usuário (access.ts) é somado pelas rotas, também em AND.
 */
export function transactionFilterWhere(sp: URLSearchParams): Prisma.TransactionWhereInput {
  const get = (k: string) => sp.get(k) ?? "";
  const and: Prisma.TransactionWhereInput[] = [];

  const onlyIgnored = get("onlyIgnored") === "true";
  const showIgnored = get("showIgnored") === "true";
  if (onlyIgnored) and.push({ ignored: true });
  else if (!showIgnored) and.push({ ignored: false });

  // Filtros globais
  if (get("accountId")) and.push({ accountId: get("accountId") });
  if (get("companyId")) and.push({ account: { companyId: get("companyId") } });
  // from/to já chegam como ISO/UTC dos limites do dia no fuso local do cliente (ver transactions/page)
  const from = get("from");
  const to = get("to");
  if (from || to) and.push({ date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } });

  // Filtros de coluna
  if (get("colAccount")) and.push({ accountId: get("colAccount") });
  if (get("colCompany")) and.push({ account: { companyId: get("colCompany") } });
  // SQLite/libSQL não tem mode:"insensitive" — contains já ignora caixa em ASCII
  const search = get("search");
  if (search) and.push({ OR: [{ description: { contains: search } }, { reference: { contains: search } }] });

  const colStatus = get("colStatus");
  if (colStatus === "categorized") and.push({ splits: { some: { managerialCategoryId: { not: null } } } });
  if (colStatus === "pending") and.push({ NOT: { splits: { some: { managerialCategoryId: { not: null } } } } });
  const colStatusAccounting = get("colStatusAccounting");
  if (colStatusAccounting === "categorized") and.push({ splits: { some: { accountingCategoryId: { not: null } } } });
  if (colStatusAccounting === "pending") and.push({ NOT: { splits: { some: { accountingCategoryId: { not: null } } } } });

  const colDirection = get("colDirection");
  if (colDirection === "in") and.push({ amount: { gt: 0 } });
  if (colDirection === "out") and.push({ amount: { lt: 0 } });

  // Possui Fatura (check de vazamento): meta = todas Meta, com = tem PDF, sem = Meta sem PDF (🔴)
  const colFatura = get("colFatura");
  if (colFatura === "meta") and.push({ isMetaCharge: true });
  if (colFatura === "com") and.push({ isMetaCharge: true, hasReceipt: true });
  if (colFatura === "sem") and.push({ isMetaCharge: true, hasReceipt: false });

  if (get("colManagerial")) and.push({ splits: { some: { managerialCategoryId: get("colManagerial") } } });
  if (get("colAccounting")) and.push({ splits: { some: { accountingCategoryId: get("colAccounting") } } });

  // Valor: o usuário digita o valor absoluto; a transação pode ser positiva ou negativa
  const min = get("colAmountMin");
  const max = get("colAmountMax");
  if (min || max) {
    and.push({
      OR: [
        { amount: { ...(min ? { gte: parseFloat(min) } : {}), ...(max ? { lte: parseFloat(max) } : {}) } },
        { amount: { ...(min ? { lte: -parseFloat(min) } : {}), ...(max ? { gte: -parseFloat(max) } : {}) } },
      ],
    });
  }

  return { AND: and };
}
