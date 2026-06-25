import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = {
  referenceNumber?: string | null;
  transactionId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  cardLast4?: string | null;
  amountUsd?: number | null;
  date?: string | null;
};

/**
 * POST /api/admin/import-receipts — recebe o receipts-parsed.json (array) e carrega em
 * MetaReceipt. Cria a tabela se não existir. Aditivo/idempotente (skipDuplicates por
 * transactionId). Exige login.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // garante a tabela em prod (idempotente)
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MetaReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "accountId" TEXT,
    "accountName" TEXT,
    "cardLast4" TEXT,
    "amountUsd" REAL,
    "date" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MetaReceipt_transactionId_key" ON "MetaReceipt"("transactionId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MetaReceipt_referenceNumber_idx" ON "MetaReceipt"("referenceNumber")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MetaReceipt_accountId_idx" ON "MetaReceipt"("accountId")`);

  const rows = (await request.json()) as Row[];
  if (!Array.isArray(rows)) return NextResponse.json({ error: "esperado um array" }, { status: 400 });

  // dedup por transactionId (alguns recibos podem repetir o id) + ignora os sem id
  const byId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.transactionId && !byId.has(r.transactionId)) byId.set(r.transactionId, r);
  const data = [...byId.values()].map((r) => ({
    transactionId: r.transactionId!,
    referenceNumber: r.referenceNumber ?? null,
    accountId: r.accountId ?? null,
    accountName: r.accountName ?? null,
    cardLast4: r.cardLast4 ?? null,
    amountUsd: r.amountUsd ?? null,
    date: r.date ? new Date(r.date) : null,
  }));

  // replace completo: o JSON é o conjunto inteiro dos recibos
  await prisma.metaReceipt.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < data.length; i += 200) {
    const res = await prisma.metaReceipt.createMany({ data: data.slice(i, i + 200) });
    inserted += res.count;
  }

  // recalcula "Possui Fatura": cobrança Meta cujo código bate com um PDF salvo
  const { comFatura, metaSemFatura } = await recomputeHasReceipt();

  return NextResponse.json({ ok: true, recebidos: rows.length, inseridos: inserted, comFatura, metaSemFatura });
}
