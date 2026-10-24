import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { recomputeHasReceipt } from "@/lib/receipts";
import { chaveFaturaMeta, pdfsQueChegaram } from "@/lib/faturasMeta";

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
  arquivo?: boolean; // a tela subiu o PDF pro R2 (o servidor confere antes de gravar o vínculo)
};

/**
 * POST /api/admin/import-receipts — recebe o receipts-parsed.json (array) e carrega em
 * MetaReceipt (a tabela nasce na migration). Aditivo/idempotente (skipDuplicates por
 * transactionId). Superadmin e admins.
 * PDF: a tela sobe cada fatura pro R2 antes (/arquivos) e marca `arquivo: true`; aqui só vira vínculo
 * o que o R2 CONFIRMA que chegou. Reimportar sem o arquivo mantém o PDF que já estava guardado.
 */
export const POST = guarded(async (request: Request) => {
  // superadmin e admins (passos 2 e 4 do Fechamento Meta — decisão do dono em 2026-10-16); member não
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores importam as faturas (PDFs)");

  const rows = (await request.json()) as Row[];
  if (!Array.isArray(rows)) return NextResponse.json({ error: "esperado um array" }, { status: 400 });

  // dedup por transactionId (alguns recibos podem repetir o id) + ignora os sem id
  const byId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.transactionId && !byId.has(r.transactionId)) byId.set(r.transactionId, r);
  // PDFs: só os que o R2 confirma; quem não veio com arquivo mantém o que já estava guardado
  const chegaram = await pdfsQueChegaram([...byId.values()].filter((r) => r.arquivo).map((r) => r.transactionId!));
  const jaGuardados = new Map(
    (await prisma.metaReceipt.findMany({ where: { transactionId: { in: [...byId.keys()] }, fileKey: { not: null } }, select: { transactionId: true, fileKey: true, fileSize: true } }))
      .map((f) => [f.transactionId, f]),
  );
  const arquivoDe = (id: string) =>
    chegaram.has(id) ? { fileKey: chaveFaturaMeta(id), fileSize: chegaram.get(id)! } : { fileKey: jaGuardados.get(id)?.fileKey ?? null, fileSize: jaGuardados.get(id)?.fileSize ?? null };
  const data = [...byId.values()].map((r) => ({
    transactionId: r.transactionId!,
    ...arquivoDe(r.transactionId!),
    referenceNumber: r.referenceNumber ?? null,
    accountId: r.accountId ?? null,
    accountName: r.accountName ?? null,
    cardLast4: r.cardLast4 ?? null,
    amountUsd: r.amountUsd ?? null,
    date: r.date ? new Date(r.date) : null,
  }));

  // ADITIVO por mês: substitui só os recibos DESTE upload (por transactionId) e preserva os
  // outros meses. Assim ler só a pasta de junho NÃO apaga maio (e vice-versa).
  const ids = data.map((d) => d.transactionId);
  for (let i = 0; i < ids.length; i += 400) {
    await prisma.metaReceipt.deleteMany({ where: { transactionId: { in: ids.slice(i, i + 400) } } });
  }
  let inserted = 0;
  for (let i = 0; i < data.length; i += 200) {
    const res = await prisma.metaReceipt.createMany({ data: data.slice(i, i + 200) });
    inserted += res.count;
  }

  // recalcula "Possui Fatura": cobrança Meta cujo código bate com um PDF salvo
  const { comFatura, metaSemFatura } = await recomputeHasReceipt();

  // histórico (Fechamento Meta → "Importações deste mês"); faturas não são de uma empresa só
  const datas = data.map((d) => d.date).filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  const raw = request.headers.get("x-filename");
  let filename: string | null = null;
  try { filename = raw ? decodeURIComponent(raw).slice(0, 200) : null; } catch { filename = raw?.slice(0, 200) ?? null; }
  await prisma.importLog.create({
    data: {
      kind: "faturas_pdf",
      filename,
      userId: user.id,
      periodFrom: datas[0] ?? null,
      periodTo: datas[datas.length - 1] ?? null,
      companyIds: [],
      summary: JSON.stringify({ recebidos: rows.length, inseridos: inserted, pdfsGuardados: chegaram.size, comFatura, metaSemFatura }),
    },
  });

  return NextResponse.json({ ok: true, recebidos: rows.length, inseridos: inserted, pdfsGuardados: chegaram.size, comFatura, metaSemFatura });
});
