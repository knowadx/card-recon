import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/revolut-raw?find=<texto> — procura um texto (ex.: o código "6ulyfvmht2" ou
 * "facebk") DENTRO do JSON cru das transações da API Revolut, e retorna as que casarem
 * (raw completo) — pra ver EM QUE CAMPO o código aparece. Sem find, lista os Facebook/Meta.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const find = (new URL(request.url).searchParams.get("find") || "").toLowerCase();

  const cred = await prisma.credential.findFirst({ where: { issuer: "revolut", isActive: true }, select: { company: true } });
  if (!cred) return NextResponse.json({ error: "nenhuma credencial Revolut ativa" }, { status: 400 });
  let token: string;
  try { token = await getValidAccessToken(cred.company); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 401 }); }

  const headers = { Authorization: `Bearer ${token}` };
  const from = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const listRes = await fetch(`${REVOLUT_BASE}/transactions?count=1000&from=${from}`, { headers });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = await listRes.json();
  if (!Array.isArray(list)) return NextResponse.json({ error: "list não retornou array", raw: list }, { status: 502 });

  // procura o texto no JSON cru de cada transação (list)
  const term = find || "facebk";
  const hits = list.filter((t) => JSON.stringify(t).toLowerCase().includes(term));

  // também busca no DETALHE de uma cobrança Meta (pode ter campo a mais)
  const metaOne = list.find((t) => /facebk|facebook|meta/i.test(JSON.stringify(t)));
  let detail = null;
  if (metaOne) {
    const detRes = await fetch(`${REVOLUT_BASE}/transaction/${metaOne.id}`, { headers });
    detail = { status: detRes.status, body: await detRes.json() };
  }

  return NextResponse.json({
    procurou: term,
    totalTransacoes: list.length,
    achouNoListCru: hits.length,
    transacoesQueContemOTermo: hits.slice(0, 5), // raw completo — aqui veria o campo com o código
    exemploDetalheMeta: detail, // raw do /transaction/{id} de uma Meta
  });
}
