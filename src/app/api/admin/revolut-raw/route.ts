import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/revolut-raw — compara o JSON cru da transação Revolut no endpoint LIST
 * vs no DETALHE (/transaction/{id}), pra achar onde está o descritor "Facebk *XXXX".
 * Pega uma credencial Revolut ativa automaticamente. Exige login.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cred = await prisma.credential.findFirst({ where: { issuer: "revolut", isActive: true }, select: { company: true } });
  if (!cred) return NextResponse.json({ error: "nenhuma credencial Revolut ativa" }, { status: 400 });

  let token: string;
  try { token = await getValidAccessToken(cred.company); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 401 }); }

  const headers = { Authorization: `Bearer ${token}` };
  const from = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const listRes = await fetch(`${REVOLUT_BASE}/transactions?count=100&from=${from}`, { headers });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = await listRes.json();
  if (!Array.isArray(list)) return NextResponse.json({ error: "list não retornou array", raw: list }, { status: 502 });

  // acha uma transação de cartão Meta
  const meta = list.find((t) => /meta|facebk|facebook/i.test(t?.merchant?.name ?? "") || (t?.legs ?? []).some((l: { description?: string }) => /facebk|meta|facebook/i.test(l?.description ?? "")));
  if (!meta) return NextResponse.json({ erro: "nenhuma Meta nas últimas 100", amostraMerchants: list.slice(0, 10).map((t) => t?.merchant?.name) });

  const detRes = await fetch(`${REVOLUT_BASE}/transaction/${meta.id}`, { headers });
  const detail = await detRes.json();

  return NextResponse.json({
    listItem: meta,                 // como veio no LIST (o que o sync usa)
    detailStatus: detRes.status,
    detailItem: detail,             // como vem no DETALHE (/transaction/{id})
  });
}
