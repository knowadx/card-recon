import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { extractMetaRef } from "@/lib/metaCheck";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/import-revolut-csv — body: texto cru do CSV de extrato da Revolut Business.
 * A API NÃO traz o descritor "Facebk *XXXX" (ela limpa pra "Meta Pay"); o CSV traz, na coluna
 * "Description". Aqui a gente SÓ enriquece: pega [ID(UUID) → metaRef extraído da Description] e
 * grava metaRef nas transações Revolut que a API já importou (reference = revolut:<UUID>:<leg>).
 * Não cria/duplica transação nenhuma. Idempotente.
 */

// parser de linha CSV respeitando aspas
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const csv = await request.text();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return NextResponse.json({ error: "CSV vazio ou só cabeçalho" }, { status: 400 });

  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  const descIdx = header.indexOf("description");
  if (idIdx < 0 || descIdx < 0) {
    return NextResponse.json({ error: `CSV sem coluna ID/Description. Cabeçalho lido: ${header.join("|")}` }, { status: 400 });
  }

  // [UUID → metaRef] só das linhas que têm código no Description
  const refByUuid = new Map<string, string>();
  let linhasComCodigo = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const uuid = (cols[idIdx] || "").trim();
    const code = extractMetaRef(cols[descIdx] || "");
    if (!uuid || !code) continue;
    if (!/^[0-9a-fA-F-]{30,}$/.test(uuid)) continue; // UUID sanidade
    refByUuid.set(uuid, code.toLowerCase());
    linhasComCodigo++;
  }
  if (refByUuid.size === 0) return NextResponse.json({ error: "Nenhuma linha com 'Facebk *XXXX' no Description", linhas: lines.length - 1 }, { status: 400 });

  // transações Revolut já importadas pela API (casa por reference = revolut:<UUID>:<leg>)
  const txs = await prisma.transaction.findMany({
    where: { reference: { startsWith: "revolut:" } },
    select: { id: true, reference: true, metaRef: true },
  });

  // monta updates (id da transação → metaRef), só onde o UUID do CSV bate
  const updates: { id: string; metaRef: string }[] = [];
  let jaTinha = 0;
  for (const t of txs) {
    const uuid = (t.reference ?? "").split(":")[1];
    const code = uuid ? refByUuid.get(uuid) : undefined;
    if (!code) continue;
    if (t.metaRef && t.metaRef.toLowerCase() === code) { jaTinha++; continue; }
    updates.push({ id: t.id, metaRef: code });
  }

  // aplica em lote via CASE (poucas queries; id e metaRef são alfanuméricos seguros)
  let gravados = 0;
  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const safe = chunk.filter((u) => /^[A-Za-z0-9_]+$/.test(u.id) && /^[a-z0-9]+$/.test(u.metaRef));
    if (safe.length === 0) continue;
    const cases = safe.map((u) => `WHEN '${u.id}' THEN '${u.metaRef}'`).join(" ");
    const ids = safe.map((u) => `'${u.id}'`).join(",");
    await prisma.$executeRawUnsafe(`UPDATE "Transaction" SET "metaRef" = CASE "id" ${cases} END WHERE "id" IN (${ids})`);
    gravados += safe.length;
  }

  return NextResponse.json({
    linhasCsv: lines.length - 1,
    linhasComCodigoNoCsv: linhasComCodigo,
    uuidsUnicosComCodigo: refByUuid.size,
    transacoesRevolutNoBanco: txs.length,
    metaRefGravados: gravados,
    jaTinhamOMesmoCodigo: jaTinha,
  });
}
