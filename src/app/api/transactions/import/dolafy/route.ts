import { prisma } from "@/lib/db";

// Proper CSV parser that handles quoted fields (same as generic import)
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = parseLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    });
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDolafyDate(raw: string): Date {
  // "Jun 2, 2026, 09:38" or "Jun 2, 2026"
  const m = raw.trim().match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})(?:,\s+(\d{2}):(\d{2}))?/);
  if (m) {
    const [, mon, day, year, hh = "12", mm = "00"] = m;
    const month = MONTHS[mon] ?? "01";
    return new Date(`${year}-${month}-${day.padStart(2, "0")}T${hh}:${mm}:00Z`);
  }
  return new Date(raw);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const accountId = formData.get("accountId") as string | null;

  if (!file || !accountId) {
    return Response.json({ error: "file and accountId required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });

  const text = await file.text();
  const rows = parseCSV(text);

  if (rows.length === 0) return Response.json({ error: "arquivo vazio ou inválido" }, { status: 400 });

  const existing = await prisma.transaction.findMany({
    where: { accountId, reference: { not: null } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((t) => t.reference));

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    // Only import Completed
    if (row["status"]?.toLowerCase() !== "completed") continue;

    const rawDate = row["date"] ?? "";
    const description = (row["description"] ?? "").trim();
    const rawAmount = (row["source amount"] ?? row["amount"] ?? "").replace(/,/g, "");
    const currency = (row["source currency"] ?? row["currency"] ?? account.currency).trim() || account.currency;
    // Preserve sign from original amount field
    const sign = parseFloat((row["amount"] ?? "0").replace(/,/g, "")) < 0 ? -1 : 1;
    const amount = parseFloat(rawAmount) * sign;

    if (!description || isNaN(amount)) continue;

    const date = parseDolafyDate(rawDate);
    if (isNaN(date.getTime())) continue;

    const reference = `dolafy:${rawDate}:${description}:${row["amount"] ?? rawAmount}`;
    if (existingRefs.has(reference)) { skipped++; continue; }
    existingRefs.add(reference);

    try {
      await prisma.transaction.create({
        data: { accountId, date, description, amount, currency, reference },
      });
      imported++;
    } catch { skipped++; }
  }

  return Response.json({ imported, skipped });
}
