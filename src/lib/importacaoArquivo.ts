import { prisma } from "./db";

/**
 * Arquivo SEM período dentro (planilha Husky, Dolafy, CSV genérico) — decisão do dono em 2026-11-12:
 * "perguntar o período". A rota importa os lançamentos, grava o histórico (ImportLog) e devolve o período
 * SUGERIDO (1ª e última data lidas no arquivo); a tela pergunta "este arquivo cobre de … a …?" e só com a
 * confirmação grava a cobertura (POST /api/coverage/periodo). Sem confirmação, o mês não conta como importado.
 */
export const KINDS_DE_ARQUIVO = ["husky", "dolafy", "csv"] as const;
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
  const periodo = ord.length ? { de: dia(ord[0]), ate: dia(ord[ord.length - 1]) } : null;
  const log = await prisma.importLog.create({
    data: {
      kind: opts.kind,
      filename: opts.filename?.slice(0, 200) || null,
      userId: opts.userId,
      periodFrom: periodo ? new Date(`${periodo.de}T00:00:00.000Z`) : null,
      periodTo: periodo ? new Date(`${periodo.ate}T00:00:00.000Z`) : null,
      companyIds: [opts.account.companyId],
      summary: JSON.stringify({ ...opts.resumo, conta: opts.account.name, accountId: opts.account.id }),
    },
  });
  return { importLogId: log.id, periodo };
}
