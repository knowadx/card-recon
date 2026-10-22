import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, guarded, requireUser, transactionScope } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { extractMetaRef, last4Of } from "@/lib/metaCheck";
import { recomputeHasReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/import-revolut-csv — body: texto cru do CSV de extrato da Revolut Business.
 * A API NÃO traz o descritor "Facebk *XXXX" (ela limpa pra "Meta Pay"); o CSV traz, na coluna
 * "Description". Aqui a gente SÓ enriquece: pega [ID(UUID) → metaRef extraído da Description] e
 * grava metaRef nas transações Revolut que a API já importou (reference = revolut:<UUID>:<leg>).
 * Não cria/duplica transação nenhuma. Idempotente.
 *
 * Também CONSERTA linha antiga: a linha do CSV tem o código "Facebk *XXXX", então a transação É
 * cobrança da Meta — marca isMetaCharge e preenche o cartão (Card number/Card label) se estiver vazio.
 * (Achado em 2026-10-22: 1.204 cobranças da Revolut gravadas pelo sistema antigo em 28/08 ficaram sem
 * a marca e sem cartão — o sync atual pula transação existente — e sumiam do Fechamento.)
 * Nunca sobrescreve cartão que já existe.
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

/** Nome do arquivo que a tela manda no cabeçalho x-filename (codificado — pode ter acento). */
function nomeDoArquivo(request: Request): string | null {
  const raw = request.headers.get("x-filename");
  if (!raw) return null;
  try { return decodeURIComponent(raw).slice(0, 200); } catch { return raw.slice(0, 200); }
}

export const POST = guarded(async (request: Request) => {
  // superadmin e admins (passos 2 e 4 do Fechamento Meta — decisão do dono em 2026-10-16); member não
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores importam o CSV da Revolut");

  const csv = await request.text();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return NextResponse.json({ error: "CSV vazio ou só cabeçalho" }, { status: 400 });

  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  const descIdx = header.indexOf("description");
  const cardIdx = header.indexOf("card number");
  const labelIdx = header.indexOf("card label");
  const dateIdx = header.indexOf("date completed (utc)") >= 0 ? header.indexOf("date completed (utc)") : header.indexOf("date started (utc)");
  if (idIdx < 0 || descIdx < 0) {
    return NextResponse.json({ error: `CSV sem coluna ID/Description. Cabeçalho lido: ${header.join("|")}` }, { status: 400 });
  }

  // [UUID → {code, cartão, label, data}] só das linhas que têm código no Description
  type Row = { code: string; card: string; label: string; date: string };
  const refByUuid = new Map<string, Row>();
  let linhasComCodigo = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const uuid = (cols[idIdx] || "").trim();
    const code = extractMetaRef(cols[descIdx] || "");
    if (!uuid || !code) continue;
    if (!/^[0-9a-fA-F-]{30,}$/.test(uuid)) continue; // UUID sanidade
    refByUuid.set(uuid, {
      code: code.toLowerCase(),
      card: cardIdx >= 0 ? (cols[cardIdx] || "").trim() : "",
      label: labelIdx >= 0 ? (cols[labelIdx] || "").trim() : "",
      date: dateIdx >= 0 ? (cols[dateIdx] || "").trim() : "",
    });
    linhasComCodigo++;
  }
  if (refByUuid.size === 0) return NextResponse.json({ error: "Nenhuma linha com 'Facebk *XXXX' no Description", linhas: lines.length - 1 }, { status: 400 });

  // transações Revolut já importadas pela API (casa por reference = revolut:<UUID>:<leg>)
  // só as transações do grupo de quem importa (superadmin = todas): admin nunca grava código em transação de outro grupo
  const txs = await prisma.transaction.findMany({
    where: { AND: [{ reference: { startsWith: "revolut:" } }, await transactionScope(user)] },
    select: { id: true, reference: true, metaRef: true, isMetaCharge: true, cardLast4: true, cardLabel: true, account: { select: { name: true, companyId: true } } },
  });

  // monta updates (id da transação → metaRef), só onde o UUID do CSV bate
  const updates: { id: string; metaRef: string }[] = [];
  // conserto de linha antiga: marca como Meta e preenche cartão vazio (nunca sobrescreve)
  const consertos: { id: string; data: { isMetaCharge?: true; cardLast4?: string; cardLabel?: string } }[] = [];
  let marcadasMeta = 0, cartoesPreenchidos = 0;
  const matched = new Set<string>(); // UUIDs do CSV que acharam transação no banco
  let jaTinha = 0;
  const porConta: Record<string, number> = {}; // códigos que este CSV casou, por conta (pro histórico)
  const empresas = new Set<string>();
  for (const t of txs) {
    const uuid = (t.reference ?? "").split(":")[1];
    const row = uuid ? refByUuid.get(uuid) : undefined;
    if (!row) continue;
    matched.add(uuid);
    porConta[t.account.name] = (porConta[t.account.name] ?? 0) + 1;
    empresas.add(t.account.companyId);
    const conserto: { isMetaCharge?: true; cardLast4?: string; cardLabel?: string } = {};
    if (!t.isMetaCharge) { conserto.isMetaCharge = true; marcadasMeta++; }
    const final = last4Of(row.card);
    if (!t.cardLast4 && final) { conserto.cardLast4 = final; cartoesPreenchidos++; }
    if (!t.cardLabel && row.label) conserto.cardLabel = row.label;
    if (Object.keys(conserto).length) consertos.push({ id: t.id, data: conserto });
    if (t.metaRef && t.metaRef.toLowerCase() === row.code) { jaTinha++; continue; }
    updates.push({ id: t.id, metaRef: row.code });
  }

  // GAP: UUIDs com código no CSV que NÃO têm transação no banco (sync não trouxe) — por cartão e data
  const naoAchadosPorCartao: Record<string, number> = {};
  let minData = "", maxData = "";
  let naoAchados = 0;
  for (const [uuid, row] of refByUuid) {
    if (matched.has(uuid)) continue;
    naoAchados++;
    const last4 = row.card.slice(-4);
    const key = `${row.label || "?"} (${last4 || "?"})`;
    naoAchadosPorCartao[key] = (naoAchadosPorCartao[key] ?? 0) + 1;
    if (row.date) { if (!minData || row.date < minData) minData = row.date; if (!maxData || row.date > maxData) maxData = row.date; }
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

  // conserto das linhas antigas (parametrizado: o nome do cartão é texto livre)
  for (let i = 0; i < consertos.length; i += CHUNK) {
    await prisma.$transaction(consertos.slice(i, i + CHUNK).map((c) => prisma.transaction.update({ where: { id: c.id }, data: c.data })));
  }

  // ordena o gap por cartão (maior primeiro)
  const gapPorCartao = Object.entries(naoAchadosPorCartao).sort((a, b) => b[1] - a[1]).map(([cartao, qtde]) => ({ cartao, qtde }));

  // recalcula "Possui Fatura" (agora que os códigos da Revolut entraram)
  const { comFatura, metaSemFatura } = await recomputeHasReceipt();

  // histórico (Fechamento Meta → "Importações deste mês"): o que entrou, de quando, por quem e o resultado
  const datas = [...refByUuid.values()].map((r) => r.date.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  await prisma.importLog.create({
    data: {
      kind: "csv_revolut",
      filename: nomeDoArquivo(request),
      userId: user.id,
      periodFrom: datas.length ? new Date(`${datas[0]}T00:00:00.000Z`) : null,
      periodTo: datas.length ? new Date(`${datas[datas.length - 1]}T00:00:00.000Z`) : null,
      companyIds: [...empresas],
      summary: JSON.stringify({ linhasCsv: lines.length - 1, comCodigoNoCsv: refByUuid.size, gravados, jaTinham: jaTinha, marcadasMeta, cartoesPreenchidos, semTransacaoNoBanco: naoAchados, porConta }),
    },
  });

  return NextResponse.json({
    linhasCsv: lines.length - 1,
    linhasComCodigoNoCsv: linhasComCodigo,
    uuidsUnicosComCodigo: refByUuid.size,
    transacoesRevolutNoBanco: txs.length,
    metaRefGravados: gravados,
    jaTinhamOMesmoCodigo: jaTinha,
    marcadasMeta, // estavam sem a marca de cobrança Meta (linha antiga) e foram marcadas
    cartoesPreenchidos, // estavam sem cartão e ganharam o do CSV
    semTransacaoNoBanco: naoAchados, // CSV tem o código mas a API não trouxe a transação
    gapPeriodo: naoAchados ? { de: minData, ate: maxData } : null,
    gapPorCartao, // quais cartões concentram as cobranças que faltam no banco
    comFatura, metaSemFatura, // Possui Fatura recalculado
  });
});
