import { prisma } from "@/lib/db";
import * as XLSX from "xlsx";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;

    if (!file || !accountId) {
      return Response.json({ error: "file and accountId required" }, { status: 400 });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return Response.json({ error: "account not found" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" });

    // Row 0 = headers, Row 1 = "Start date / Initial balance" — skip both
    const dataRows = rows.slice(2) as string[][];

    const candidates = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rawDate = (row[0] || "").toString().trim();
      const event = (row[1] || "").toString().trim();
      const payer = (row[2] || "").toString().trim();
      const beneficiary = (row[3] || "").toString().trim();
      const rawAmount = (row[4] || "").toString().trim(); // Amount (column E)

      if (!rawDate || !rawAmount) continue;

      const dateStr = rawDate.slice(0, 10);
      const date = new Date(`${dateStr}T12:00:00.000Z`);
      if (isNaN(date.getTime())) continue;

      const amountStr = rawAmount.replace(/,/g, "").replace(/[^\d.-]/g, "");
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount === 0) continue;

      const parts = [event, beneficiary || payer].filter(Boolean);
      const description = parts.join(" · ") || "Husky";

      candidates.push({
        accountId,
        date,
        description,
        amount,
        currency: account.currency,
        reference: `husky:${dateStr}:${amountStr}:${description}`,
      });
    }

    if (candidates.length === 0) {
      return Response.json({ imported: 0, skipped: 0, message: "Nenhuma linha válida encontrada" });
    }

    const existing = await prisma.transaction.findMany({
      where: { accountId, reference: { not: null } },
      select: { reference: true },
    });
    const existingRefs = new Set(existing.map((t) => t.reference));
    const toCreate = candidates.filter((c) => !existingRefs.has(c.reference));

    if (toCreate.length > 0) {
        await prisma.transaction.createMany({ data: toCreate });
    }

    return Response.json({
      imported: toCreate.length,
      skipped: candidates.length - toCreate.length,
      total: candidates.length,
    });
  } catch (e) {
    console.error("Husky import error:", e);
    console.error(e); return Response.json({ error: "Erro interno" }, { status: 500 });
  }
}
