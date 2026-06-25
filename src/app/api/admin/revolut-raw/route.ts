import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/revolut-raw — chama a API da Revolut AO VIVO e DUMPA o JSON cru completo
 * das cobranças que parecem Meta/Facebook, sem filtrar campo nenhum. Pra a gente olhar com o
 * olho TODO campo que a API devolve (list e detail), e ver os nomes de merchant que existem.
 *   ?find=<texto>  (opcional) — também procura o texto no raw e devolve quem contém.
 *   ?days=90       (opcional) — janela.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const term = (url.searchParams.get("find") || "").toLowerCase();
  const days = Number(url.searchParams.get("days") || "90");
  const idsParam = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const META_RE = /meta|facebook|facebk|fb\b/i;

  const creds = await prisma.credential.findMany({ where: { issuer: "revolut", isActive: true, NOT: { token: "" } }, select: { company: true } });
  if (creds.length === 0) return NextResponse.json({ error: "nenhuma credencial Revolut consentida" }, { status: 400 });

  // MODO ALVO: buscar IDs específicos (ex.: os UUIDs que no CSV têm "Facebk *XXXX") via /transaction/{id}
  // em cada credencial, e dumpar o raw inteiro. Teste definitivo: a MESMA transação tem o código na API?
  if (idsParam.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const achados: any[] = [];
    for (const cred of creds) {
      let token: string;
      try { token = await getValidAccessToken(cred.company); } catch { continue; }
      for (const id of idsParam) {
        try {
          const r = await fetch(`${REVOLUT_BASE}/transaction/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          const body = await r.text();
          if (r.ok) {
            const raw = JSON.parse(body);
            achados.push({ company: cred.company, id, status: r.status, contemFacebk: /facebk/i.test(body), raw });
          } else if (r.status !== 404) {
            achados.push({ company: cred.company, id, status: r.status, corpo: body.slice(0, 200) });
          }
        } catch (e) { achados.push({ company: cred.company, id, erro: String(e).slice(0, 150) }); }
      }
    }
    return NextResponse.json({ modo: "ids", buscou: idsParam, resultados: achados });
  }

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contas: any[] = [];

  for (const cred of creds) {
    try {
      const token = await getValidAccessToken(cred.company);
      const res = await fetch(`${REVOLUT_BASE}/transactions?count=1000&from=${from}`, { headers: { Authorization: `Bearer ${token}` } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: any[] = await res.json();
      if (!Array.isArray(list)) { contas.push({ company: cred.company, erro: JSON.stringify(list).slice(0, 200) }); continue; }

      // nomes de merchant distintos (pra ver se existe "Facebook" além de "Meta Pay")
      const merchantNames: Record<string, number> = {};
      for (const t of list) { const n = t?.merchant?.name ?? `(sem merchant / type=${t?.type})`; merchantNames[n] = (merchantNames[n] ?? 0) + 1; }

      // cobranças que parecem Meta
      const metaTx = list.filter((t) => {
        const blob = `${t?.merchant?.name ?? ""} ${(t?.legs ?? []).map((l: { description?: string }) => l?.description ?? "").join(" ")}`;
        return META_RE.test(blob);
      });

      // RAW COMPLETO de até 3 cobranças Meta — list + detail (/transaction/{id} às vezes traz mais)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMetaCompleto: any[] = [];
      for (const t of metaTx.slice(0, 3)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let detail: any = null;
        try {
          const dr = await fetch(`${REVOLUT_BASE}/transaction/${t.id}`, { headers: { Authorization: `Bearer ${token}` } });
          detail = await dr.json();
        } catch (e) { detail = { erro: String(e).slice(0, 120) }; }
        rawMetaCompleto.push({ rawDaLista: t, rawDoDetail: detail });
      }

      const hits = term ? list.filter((t) => JSON.stringify(t).toLowerCase().includes(term)) : [];

      contas.push({
        company: cred.company,
        totalTx: list.length,
        qtdeMeta: metaTx.length,
        merchantNamesDistintos: merchantNames,
        rawMetaCompleto, // <-- TODO campo que a API devolve, sem filtro
        ...(term ? { procurou: term, hits: hits.length, rawDosHits: hits.slice(0, 3) } : {}),
      });
    } catch (e) {
      contas.push({ company: cred.company, erro: String(e).slice(0, 200) });
    }
  }

  return NextResponse.json({ janelaDias: days, credenciais: creds.length, contas });
}
