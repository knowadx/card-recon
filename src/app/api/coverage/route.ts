import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isSuperadmin } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || !isSuperadmin(session.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
  const companies = await prisma.company.findMany({
    include: {
      accounts: {
        include: {
          transactions: {
            where: { ignored: false },
            select: { date: true, splits: { select: { id: true } } },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

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
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
}
