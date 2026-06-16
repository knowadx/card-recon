import { prisma } from "@/lib/db";

// Proper CSV parser that handles quoted fields with commas inside
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

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = parseLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    });
}

function detectColumn(headers: string[], candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const match = headers.find((h) => h === candidate || h.startsWith(candidate));
    if (match) return match;
  }
  return undefined;
}

// Parse dates in MM-DD-YYYY or YYYY-MM-DD or DD/MM/YYYY format
function parseDate(raw: string): Date {
  const s = raw.trim();
  // MM-DD-YYYY (Mercury format)
  const mmddyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (mmddyyyy) return new Date(`${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`);
  // DD/MM/YYYY
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
  return new Date(s);
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
  if (rows.length === 0) return Response.json({ error: "empty or invalid CSV" }, { status: 400 });

  const headers = Object.keys(rows[0]);
  const dateCol = detectColumn(headers, ["date", "data", "dt"]);
  const descCol = detectColumn(headers, ["description", "descricao", "desc", "memo", "historico"]);
  const amountCol = detectColumn(headers, ["amount", "valor", "value", "credit/debit"]);
  const statusCol = detectColumn(headers, ["status"]);
  const refCol = detectColumn(headers, ["reference", "ref"]);
  const currencyCol = detectColumn(headers, ["original currency", "currency", "moeda"]);

  if (!dateCol || !descCol || !amountCol) {
    return Response.json({ error: "could not detect date/description/amount columns", headers }, { status: 422 });
  }

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      // Skip failed transactions
      if (statusCol && row[statusCol]?.toLowerCase() === "failed") return null;

      const rawAmount = String(row[amountCol]).replace(/\s/g, "").replace(",", ".");
      const amount = parseFloat(rawAmount);
      if (isNaN(amount)) return null;

      const date = parseDate(row[dateCol]);
      if (isNaN(date.getTime())) return null;

      // Use original currency if available, otherwise account currency
      const currency = currencyCol && row[currencyCol]?.trim()
        ? row[currencyCol].trim()
        : account.currency;

      return prisma.transaction.create({
        data: {
          accountId,
          date,
          description: row[descCol],
          amount,
          currency,
          reference: refCol ? row[refCol] || null : null,
        },
      });
    })
  );

  const imported = results.filter(
    (r) => r.status === "fulfilled" && r.value !== null
  ).length;

  return Response.json({ imported });
}
