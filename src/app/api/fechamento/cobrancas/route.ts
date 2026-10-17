import { NextResponse } from "next/server";
import { assertCompany, guarded, requireUser, RequestError } from "@/lib/access";
import { cobrancasCsv, cobrancasDoMes, ondeCobrancasDoMes } from "@/lib/cobrancasMeta";

export const dynamic = "force-dynamic";

/**
 * GET /api/fechamento/cobrancas?month=AAAA-MM[&company=][&cartao=<chave>][&formato=csv]
 * Cobranças Meta do mês vistas pelo extrato (mesma lista e mesmo escopo do Fechamento):
 *  - com `cartao`: as transações daquele cartão (o "abrir" do resumo por cartão);
 *  - com `formato=csv`: o arquivo pra baixar (do mês inteiro, ou só do cartão).
 */
export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RequestError(400, "mês inválido (use AAAA-MM)");
  // empresa fora do escopo = 404 (não confirma que existe)
  const company = params.get("company") || null;
  if (company) await assertCompany(user, company);
  const cartao = params.get("cartao") || undefined;

  const cobrancas = await cobrancasDoMes(await ondeCobrancasDoMes(user, month, company), cartao);
  if (params.get("formato") !== "csv") return NextResponse.json({ month, cobrancas });

  const nome = `cobrancas-meta-${month}${cartao ? `-cartao-${cartao.split(":").pop()}` : ""}.csv`;
  return new Response(cobrancasCsv(cobrancas), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"` },
  });
});
