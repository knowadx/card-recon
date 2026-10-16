import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, accountScope, companyScope, guarded, requireUser, transactionScope } from "@/lib/access";
import { isManager } from "@/lib/auth";

// Control (cobertura de sincronização e categorização por empresa/mês). Papel lido do banco, nunca
// do cookie. Superadmin vê todas as empresas; admin vê só as do grupo dele; member não vê
// (decisão do dono em 2026-10-16).
export const GET = guarded(async () => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores veem o Control");
  const [cScope, aScope, tScope] = await Promise.all([companyScope(user), accountScope(user), transactionScope(user)]);
  try {
  const companies = await prisma.company.findMany({
    where: cScope,
    include: {
      accounts: {
        where: aScope,
        include: {
          transactions: {
            where: { AND: [{ ignored: false }, tScope] },
            select: { date: true, splits: { select: { id: true } } },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Datas de transação são dia "puro" gravado à meia-noite UTC: o mês sai em UTC, senão um
  // servidor em fuso atrás do UTC jogaria o dia 1º no mês anterior.
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  const now = new Date();
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));

  const matrix: Record<string, Record<string, number>> = {};
  const pendingMatrix: Record<string, Record<string, number>> = {};

  for (const company of companies) {
    matrix[company.id] = {};
    pendingMatrix[company.id] = {};
    for (const month of months) {
      matrix[company.id][month] = 0;
      pendingMatrix[company.id][month] = 0;
    }
    for (const account of company.accounts) {
      for (const tx of account.transactions) {
        const key = monthKey(new Date(tx.date));
        if (matrix[company.id][key] !== undefined) {
          matrix[company.id][key]++;
          if (tx.splits.length === 0) pendingMatrix[company.id][key]++;
        }
      }
    }
  }

  const accountMatrix: Record<string, Record<string, number>> = {};
  const accountPendingMatrix: Record<string, Record<string, number>> = {};
  const accountsMeta: Array<{ id: string; name: string; bank: string; companyId: string }> = [];

  for (const company of companies) {
    for (const account of company.accounts) {
      accountsMeta.push({ id: account.id, name: account.name, bank: account.bank, companyId: company.id });
      accountMatrix[account.id] = {};
      accountPendingMatrix[account.id] = {};
      for (const month of months) {
        accountMatrix[account.id][month] = 0;
        accountPendingMatrix[account.id][month] = 0;
      }
      for (const tx of account.transactions) {
        const key = monthKey(new Date(tx.date));
        if (accountMatrix[account.id][key] !== undefined) {
          accountMatrix[account.id][key]++;
          if (tx.splits.length === 0) accountPendingMatrix[account.id][key]++;
        }
      }
    }
  }

  return Response.json({
    months,
    companies: companies.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    accounts: accountsMeta,
    matrix,
    pendingMatrix,
    accountMatrix,
    accountPendingMatrix,
  });
  } catch (e) {
    console.error("Coverage error:", e);
    console.error(e); return Response.json({ error: "Erro interno" }, { status: 500 });
  }
});
