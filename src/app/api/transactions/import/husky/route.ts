import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import * as XLSX from "xlsx";
import { registrarArquivo } from "@/lib/importacaoArquivo";
import { numerarRepetidas } from "@/lib/chaveRepetida";
import { conflitoDeFormato, lerHuskyCsv, mesmaEmpresa } from "@/lib/husky";

/**
 * POST /api/transactions/import/husky (form: file, accountId) — extrato da Husky em PLANILHA (XLS, o de sempre) ou
 * CSV (dono, 2026-11-13; formato em src/lib/husky.ts), pela extensão do arquivo. CSV: o "Payer Name" do arquivo
 * tem que ser a empresa da conta. Os dois formatos não se casam linha a linha → o mesmo período não entra pelos
 * dois (409). Linhas iguais no mesmo dia/instante são lançamentos diferentes (src/lib/chaveRepetida.ts).
 */

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;

    if (!file || !accountId) {
      return Response.json({ error: "file and accountId required" }, { status: 400 });
    }

    await assertAccount(user, String(accountId)); // conta-alvo precisa ser minha — antes de gravar qualquer coisa
    const account = await prisma.account.findUnique({ where: { id: accountId }, include: { company: { select: { name: true } } } });
    if (!account) return Response.json({ error: "account not found" }, { status: 404 });

    const formato: "csv" | "xls" = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xls";
    let invalidos = 0;
    const candidates: Array<{ accountId: string; date: Date; description: string; amount: number; currency: string; reference: string }> = [];

    if (formato === "csv") {
      const lido = lerHuskyCsv(await file.text(), account.currency);
      if ("erro" in lido) throw new RequestError(400, lido.erro);
      if (!mesmaEmpresa(lido.pagador, account.company.name)) {
        throw new RequestError(400, `esse extrato é de ${lido.pagador} e a conta ${account.name} é da ${account.company.name} — conta errada?`);
      }
      invalidos = lido.invalidos;
      for (const l of lido.lancamentos) candidates.push({ accountId, date: l.data, description: l.descricao, amount: l.valor, currency: account.currency, reference: `husky:${l.chave}` });
    } else {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" });

      // Row 0 = headers, Row 1 = "Start date / Initial balance" — skip both
      const dataRows = rows.slice(2) as string[][];

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
    }

    // duas linhas iguais no mesmo dia (mesmo valor e descrição) são dois lançamentos: "#2", "#3"… (src/lib/chaveRepetida.ts)
    numerarRepetidas(candidates.map((c) => c.reference)).forEach((r, k) => { candidates[k].reference = r; });

    if (candidates.length === 0) {
      return Response.json({ imported: 0, skipped: 0, message: "Nenhuma linha válida encontrada" });
    }
    const conflito = await conflitoDeFormato(accountId, formato, candidates.map((c) => c.date));
    if (conflito) throw new RequestError(409, conflito);

    const existing = await prisma.transaction.findMany({
      where: { accountId, reference: { not: null } },
      select: { reference: true },
    });
    const existingRefs = new Set(existing.map((t) => t.reference));
    const toCreate = candidates.filter((c) => !existingRefs.has(c.reference));
    // skipDuplicates: dois envios ao mesmo tempo não viram "erro interno"
    const imported = toCreate.length ? (await prisma.transaction.createMany({ data: toCreate, skipDuplicates: true })).count : 0;

    const resumo = { imported, skipped: candidates.length - imported, total: candidates.length, invalidos, formato };
    const arquivo = await registrarArquivo({ kind: "husky", filename: file.name, userId: user.id, account, datas: candidates.map((c) => c.date), resumo });
    return Response.json({ ...resumo, ...arquivo });
  } catch (e) {
    if (e instanceof AccessError || e instanceof RequestError) throw e; // vira 4xx no guarded, não "Erro interno"
    console.error("Husky import error:", e);
    console.error(e); return Response.json({ error: "Erro interno" }, { status: 500 });
  }
});
