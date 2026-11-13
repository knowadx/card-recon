import { prisma } from "./db";

/**
 * Arquivo SEM período dentro (planilha Husky, Dolafy, CSV do Payoneer, CSV genérico) — decisão do dono em 2026-11-12:
 * "perguntar o período". A rota importa os lançamentos, grava o histórico (ImportLog) e devolve o período
 * SUGERIDO (os meses inteiros entre a 1ª e a última data lidas, até hoje); a tela pergunta "este arquivo cobre de … a …?" e só com a
 * confirmação grava a cobertura (POST /api/coverage/periodo). Sem confirmação, o mês não conta como importado.
 */
export const KINDS_DE_ARQUIVO = ["husky", "dolafy", "csv", "payoneer"] as const;
export type KindDeArquivo = (typeof KINDS_DE_ARQUIVO)[number];

const dia = (d: Date) => d.toISOString().slice(0, 10);

export async function registrarArquivo(opts: {
  kind: KindDeArquivo;
  filename: string | null;
  userId: string;
  account: { id: string; name: string; companyId: string };
  datas: Date[]; // datas de TODAS as linhas válidas do arquivo (as já existentes também contam pro período)
  resumo: Record<string, unknown>;
}): Promise<{ importLogId: string; periodo: { de: string; ate: string } | null }> {
  const ord = opts.datas.filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  const lido = ord.length ? { de: dia(ord[0]), ate: dia(ord[ord.length - 1]) } : null;
  // sugestão = os MESES inteiros (dono, 2026-11-13: dia sem movimento não aparece no arquivo, e a 1ª/última data
  // deixava o mês "importado só em parte" mesmo com o extrato do mês todo); nunca passa de hoje
  const hoje = dia(new Date());
  const fimDoMes = (d: Date) => dia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  const periodo = lido ? { de: `${lido.de.slice(0, 8)}01`, ate: [fimDoMes(ord[ord.length - 1]), hoje].sort()[0] } : null;
  const log = await prisma.importLog.create({
    data: {
      kind: opts.kind,
      filename: opts.filename?.slice(0, 200) || null,
      userId: opts.userId,
      periodFrom: lido ? new Date(`${lido.de}T00:00:00.000Z`) : null, // o que o arquivo TEM (1ª e última data)
      periodTo: lido ? new Date(`${lido.ate}T00:00:00.000Z`) : null,
      companyIds: [opts.account.companyId],
      summary: JSON.stringify({ ...opts.resumo, conta: opts.account.name, accountId: opts.account.id }),
    },
  });
  return { importLogId: log.id, periodo };
}
