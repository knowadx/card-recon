import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { coberturaDoMes, coberturaPorConta, fimDoMes, inicioDoMes } from "@/lib/cobertura";

/**
 * "Sem movimentação" num mês de uma conta (pedido do dono em 2026-11-13: "meses sem movimentação não tem como
 * marcar — precisa acrescentar isso pra termos certeza que foi feito"; e "parecem faltar alguns dias do mês
 * porque não teve movimentação no dia, mas o mês foi importado totalmente").
 *
 * POST { accountId, mes: "AAAA-MM", ate?: "AAAA-MM" } — alguém CONFERIU que os dias que nenhuma importação cobre
 * não tiveram movimento: grava a cobertura "manual" de cada mês (uma linha por mês, pra desfazer mês a mês), com
 * quem marcou e quando. `ate` = vários meses de uma vez (dono, 2026-11-13: conta sem lançamento nenhum antes do
 * 1º dado — marcar só um mês desses faria todos os do meio contarem como faltando); mês já completo no
 * intervalo fica como está. Só vale:
 *  - pra mês que já acabou (dia que não aconteceu não foi conferido);
 *  - se NENHUM lançamento da conta cai nos dias sem cobertura — lançamento ali veio de algum lugar que não
 *    registrou o período, então tem que importar o extrato de verdade (contagem não prova importação).
 * DELETE { accountId, mes } — desfaz (apaga só a marcação manual daquele mês; importações ficam).
 * Administradores, como a importação.
 */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

async function validar(request: Request) {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores marcam a importação");
  const body = await request.json().catch(() => ({}));
  const accountId = String(body.accountId ?? "");
  await assertAccount(user, accountId); // outro grupo = 404
  const mes = String(body.mes ?? "");
  if (!MES.test(mes)) throw new RequestError(400, "mês inválido (AAAA-MM)");
  return { user, accountId, mes, ate: body.ate == null ? mes : String(body.ate), ini: inicioDoMes(mes), fim: fimDoMes(mes) };
}

/** "2025-01".."2025-03" → ["2025-01","2025-02","2025-03"]. */
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = inicioDoMes(de); d.toISOString().slice(0, 7) <= ate; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7));
  return out;
}

const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export const POST = guarded(async (request: Request) => {
  const { user, accountId, mes, ate, ini } = await validar(request);
  if (!MES.test(ate) || ate < mes) throw new RequestError(400, "intervalo inválido: até (AAAA-MM) não pode ser antes do mês");
  const fim = fimDoMes(ate);
  if (fim > new Date()) throw new RequestError(400, "o mês ainda não acabou — só dá pra marcar sem movimentação depois do último dia");

  const trechos = (await coberturaPorConta([accountId])).get(accountId) ?? [];
  const aMarcar = mesesEntre(mes, ate).filter((m) => coberturaDoMes(trechos, m).estado !== "completo");
  if (!aMarcar.length) throw new RequestError(400, ate === mes ? "esse mês já está importado por inteiro" : "esses meses já estão importados por inteiro");
  const doIntervalo = await prisma.transaction.findMany({ where: { accountId, date: { gte: ini, lt: fim } }, select: { date: true }, orderBy: { date: "asc" } });
  const soltos = doIntervalo.filter((t) => !trechos.some((p) => t.date >= p.de && t.date < p.ate));
  if (soltos.length) {
    const dias = [...new Set(soltos.map((t) => br(t.date)))];
    throw new RequestError(409, `há ${soltos.length} lançamento(s) em dias que nenhuma importação cobre (${dias.slice(0, 3).join(", ")}${dias.length > 3 ? "…" : ""}) — importe o extrato desse período em vez de marcar sem movimentação`);
  }

  await prisma.importCoverage.createMany({ data: aMarcar.map((m) => ({ accountId, from: inicioDoMes(m), to: fimDoMes(m), source: "manual", userId: user.id })) });
  return Response.json({ ok: true, meses: aMarcar });
});

export const DELETE = guarded(async (request: Request) => {
  const { accountId, ini, fim } = await validar(request);
  const { count } = await prisma.importCoverage.deleteMany({ where: { accountId, source: "manual", from: ini, to: fim } });
  if (!count) throw new AccessError(404, "esse mês não tem marcação de sem movimentação");
  return Response.json({ ok: true });
});
