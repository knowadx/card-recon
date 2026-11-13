import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { fimDoMes, inicioDoMes } from "@/lib/cobertura";

/**
 * Apagar a importação de UMA conta num MÊS (dono, 2026-11-13: "botão pra deletar a importação de uma conta,
 * banco específico — pode precisar substituir alguma importação no mês, por erro no extrato"). Decisões dele:
 *  - a unidade é o MÊS DA CONTA: todos os lançamentos dessa conta no mês (de qualquer importação — o lançamento
 *    não guarda de qual arquivo veio) + a marca de "importado" do mês (trechos que passam do mês são cortados:
 *    o resto do período importado fica);
 *  - categorização vai junto, mas a confirmação MOSTRA quantos antes (GET = prévia).
 * GET ?accountId&mes → o que vai ser apagado. DELETE { accountId, mes, esperado } → apaga, se o número de
 * lançamentos ainda for o que a pessoa viu (senão 409: entrou/saiu algo depois da prévia). Fica registrado no
 * histórico de importações (ImportLog "exclusao": quem, quando, quantos). Fatura Meta (PDF) não é apagada — volta
 * a casar quando o lançamento for reimportado. Administradores, como a importação.
 */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

async function alvo(user: Awaited<ReturnType<typeof requireUser>>, accountId: string, mes: string) {
  if (!isManager(user.role)) throw new AccessError(403, "só administradores apagam importação");
  await assertAccount(user, accountId); // outro grupo = 404
  if (!MES.test(mes)) throw new RequestError(400, "mês inválido (AAAA-MM)");
  const ini = inicioDoMes(mes), fim = fimDoMes(mes);
  const doMes = { accountId, date: { gte: ini, lt: fim } };
  const [lancamentos, categorizados, comFaturaMeta, comAnexo, trechos] = await Promise.all([
    prisma.transaction.count({ where: doMes }),
    prisma.transaction.count({ where: { ...doMes, splits: { some: { managerialCategoryId: { not: null } } } } }),
    prisma.transaction.count({ where: { ...doMes, hasReceipt: true } }),
    prisma.transaction.count({ where: { ...doMes, documents: { some: {} } } }),
    prisma.importCoverage.count({ where: { accountId, from: { lt: fim }, to: { gt: ini } } }),
  ]);
  return { ini, fim, previa: { lancamentos, categorizados, comFaturaMeta, comAnexo, marcaDeImportado: trechos > 0 } };
}

export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const q = new URL(request.url).searchParams;
  const { previa } = await alvo(user, q.get("accountId") ?? "", q.get("mes") ?? "");
  return Response.json(previa);
});

export const DELETE = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const accountId = String(body.accountId ?? ""), mes = String(body.mes ?? "");
  const { ini, fim, previa } = await alvo(user, accountId, mes);
  if (typeof body.esperado !== "number") throw new RequestError(400, "informe quantos lançamentos a confirmação mostrou (esperado)");
  if (!previa.lancamentos && !previa.marcaDeImportado) throw new RequestError(400, "não há nada importado nesse mês");

  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { name: true, companyId: true } });
  await prisma.$transaction(async (tx) => {
    // splits, rateio contábil e anexos caem junto (onDelete: Cascade); entrou algo entre a prévia e aqui = desfaz tudo
    const { count } = await tx.transaction.deleteMany({ where: { accountId, date: { gte: ini, lt: fim } } });
    if (count !== body.esperado) throw new RequestError(409, `a conta tem agora ${count} lançamento(s) nesse mês, não ${body.esperado} — abra a confirmação de novo`);
    // marca de importado: some do mês; o que passa pra fora do mês fica (o trecho é cortado, mesma origem/quem/quando)
    const tocam = await tx.importCoverage.findMany({ where: { accountId, from: { lt: fim }, to: { gt: ini } } });
    await tx.importCoverage.deleteMany({ where: { id: { in: tocam.map((c) => c.id) } } });
    const base = (c: (typeof tocam)[number]) => ({ accountId, source: c.source, importLogId: c.importLogId, userId: c.userId, createdAt: c.createdAt });
    const restos = tocam.flatMap((c) => [
      ...(c.from < ini ? [{ ...base(c), from: c.from, to: ini }] : []),
      ...(c.to > fim ? [{ ...base(c), from: fim, to: c.to }] : []),
    ]);
    if (restos.length) await tx.importCoverage.createMany({ data: restos });
    await tx.importLog.create({
      data: {
        kind: "exclusao", filename: null, userId: user.id, periodFrom: ini, periodTo: new Date(fim.getTime() - 86_400_000), companyIds: [account.companyId],
        summary: JSON.stringify({ ...previa, conta: account.name, accountId, mes }),
      },
    });
  });
  return Response.json({ ok: true, ...previa });
});
