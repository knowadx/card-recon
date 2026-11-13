import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { coberturaDoMes, coberturaPorConta, fimDoMes, inicioDoMes } from "@/lib/cobertura";

/**
 * "Sem movimentação" num mês de uma conta (pedido do dono em 2026-11-13: "meses sem movimentação não tem como
 * marcar — precisa acrescentar isso pra termos certeza que foi feito"; e "parecem faltar alguns dias do mês
 * porque não teve movimentação no dia, mas o mês foi importado totalmente").
 *
 * POST { accountId, mes: "AAAA-MM" } — alguém CONFERIU que os dias do mês que nenhuma importação cobre não
 * tiveram movimento: grava a cobertura "manual" do mês inteiro, com quem marcou e quando. Só vale:
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
  return { user, accountId, mes, ini: inicioDoMes(mes), fim: fimDoMes(mes) };
}

const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export const POST = guarded(async (request: Request) => {
  const { user, accountId, mes, ini, fim } = await validar(request);
  if (fim > new Date()) throw new RequestError(400, "o mês ainda não acabou — só dá pra marcar sem movimentação depois do último dia");

  const cob = coberturaDoMes((await coberturaPorConta([accountId])).get(accountId) ?? [], mes);
  if (cob.estado === "completo") throw new RequestError(400, "esse mês já está importado por inteiro");
  const cobertos = cob.estado === "parcial" ? cob.pedacos : [];
  const doMes = await prisma.transaction.findMany({ where: { accountId, date: { gte: ini, lt: fim } }, select: { date: true }, orderBy: { date: "asc" } });
  const soltos = doMes.filter((t) => !cobertos.some((p) => t.date >= p.de && t.date < p.ate));
  if (soltos.length) {
    const dias = [...new Set(soltos.map((t) => br(t.date)))];
    throw new RequestError(409, `há ${soltos.length} lançamento(s) em dias que nenhuma importação cobre (${dias.slice(0, 3).join(", ")}${dias.length > 3 ? "…" : ""}) — importe o extrato desse período em vez de marcar sem movimentação`);
  }

  await prisma.importCoverage.create({ data: { accountId, from: ini, to: fim, source: "manual", userId: user.id } });
  return Response.json({ ok: true });
});

export const DELETE = guarded(async (request: Request) => {
  const { accountId, ini, fim } = await validar(request);
  const { count } = await prisma.importCoverage.deleteMany({ where: { accountId, source: "manual", from: ini, to: fim } });
  if (!count) throw new AccessError(404, "esse mês não tem marcação de sem movimentação");
  return Response.json({ ok: true });
});
