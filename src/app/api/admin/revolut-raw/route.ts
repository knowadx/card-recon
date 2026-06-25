import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/revolut-raw?find=<texto> — procura o texto no JSON cru das transações de
 * TODAS as credenciais Revolut ativas. Mostra a transação que contém (raw completo) → o campo.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const term = (new URL(request.url).searchParams.get("find") || "facebk").toLowerCase();
  const creds = await prisma.credential.findMany({ where: { issuer: "revolut", isActive: true }, select: { company: true } });
  if (creds.length === 0) return NextResponse.json({ error: "nenhuma credencial Revolut ativa" }, { status: 400 });

  const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const porConta: { company: string; totalTx: number; hits: number; erro?: string }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const achadas: any[] = [];

  for (const cred of creds) {
    try {
      const token = await getValidAccessToken(cred.company);
      const res = await fetch(`${REVOLUT_BASE}/transactions?count=1000&from=${from}`, { headers: { Authorization: `Bearer ${token}` } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: any[] = await res.json();
      if (!Array.isArray(list)) { porConta.push({ company: cred.company, totalTx: 0, hits: 0, erro: JSON.stringify(list).slice(0, 120) }); continue; }
      const hits = list.filter((t) => JSON.stringify(t).toLowerCase().includes(term));
      porConta.push({ company: cred.company, totalTx: list.length, hits: hits.length });
      for (const h of hits) if (achadas.length < 5) achadas.push({ company: cred.company, raw: h });
    } catch (e) {
      porConta.push({ company: cred.company, totalTx: 0, hits: 0, erro: String(e).slice(0, 120) });
    }
  }

  return NextResponse.json({
    procurou: term,
    credenciaisRevolut: creds.length,
    porConta,
    totalHits: achadas.length,
    transacoesQueContemOTermo: achadas, // raw completo — mostra em qual campo está o código
  });
}
