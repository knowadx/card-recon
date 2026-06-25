import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/revolut-expenses — chama GET /expenses AO VIVO e dumpa o raw. O objeto
 * Expense tem `description` + `merchant` + `transaction_id`. Hipótese: o "Note" que aparece
 * no app (Facebk *XXXX) vem aqui no `description`. Mostra amostra de expenses Meta + se
 * algum `description` casa com /facebk/i.
 *   ?days=90
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const days = Number(new URL(request.url).searchParams.get("days") || "90");
  const FB_RE = /faceb[a-z]*\s*\*/i;
  const META_RE = /meta|faceb/i;

  const creds = await prisma.credential.findMany({ where: { issuer: "revolut", isActive: true, NOT: { token: "" } }, select: { company: true } });
  if (creds.length === 0) return NextResponse.json({ error: "nenhuma credencial Revolut consentida" }, { status: 400 });

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contas: any[] = [];

  for (const cred of creds) {
    try {
      const token = await getValidAccessToken(cred.company);
      const res = await fetch(`${REVOLUT_BASE}/expenses?count=1000&from=${from}&transaction_type=card_payment`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      if (!res.ok) { contas.push({ company: cred.company, status: res.status, corpo: text.slice(0, 300) }); continue; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: any[] = JSON.parse(text);
      if (!Array.isArray(list)) { contas.push({ company: cred.company, naoEhArray: JSON.stringify(list).slice(0, 200) }); continue; }

      const meta = list.filter((e) => META_RE.test(`${e?.merchant ?? ""} ${e?.description ?? ""}`));
      // quantos têm o padrão "Facebk *XXXX" no description
      const comCodigo = meta.filter((e) => FB_RE.test(e?.description ?? ""));
      // amostra de descriptions distintas (pra ver o formato real do campo)
      const descrsDistintas = [...new Set(meta.map((e) => e?.description ?? "(vazio)"))].slice(0, 25);

      contas.push({
        company: cred.company,
        totalExpenses: list.length,
        qtdeMeta: meta.length,
        qtdeComCodigoFacebkNoDescription: comCodigo.length,
        descriptionsDistintas: descrsDistintas, // <-- aqui se vê o formato do campo
        amostraRaw: meta.slice(0, 5), // raw completo de 5 expenses Meta
      });
    } catch (e) {
      contas.push({ company: cred.company, erro: String(e).slice(0, 200) });
    }
  }

  return NextResponse.json({ janelaDias: days, credenciais: creds.length, contas });
}
