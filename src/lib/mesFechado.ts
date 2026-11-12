/**
 * "Mês fechado" de uma empresa — a regra ÚNICA (decisão do dono em 2026-11-12): todas as contas da empresa
 * importadas do 1º ao último dia do mês (cobertura, src/lib/cobertura.ts) E nenhum lançamento do mês sem
 * categoria gerencial. Os dois checkpoints continuam aparecendo separados; o selo só junta os dois.
 * Conta que ainda não tinha dado no mês não conta; conta NUNCA importada conta como faltando a partir do
 * 1º mês em que a empresa teve algum dado (esconder deixaria uma conta esquecida sumir).
 * Entrada = o que /api/coverage devolve por conta.
 */

/** 1º mês dos fechamentos (decisão do dono em 2026-11-12: "quero os fechamentos iniciando em janeiro de 2025"). */
export const INICIO_DOS_FECHAMENTOS = "2025-01";

export type EstadoImp = "completo" | "parcial" | "sem_comprovacao" | "faltando" | "antes";
export type ContaNoMes = { imp: EstadoImp; total: number; semCategoria: number; comComprovante?: number };
export type ContaDaEmpresa = { nuncaImportada: boolean; meses: Record<string, ContaNoMes> };
export type ResumoDoMes = { contas: number; importadas: number; pend: number; total: number; comComprovante: number; fechado: boolean; vazio: boolean };

export function resumoDoMes(contas: ContaDaEmpresa[], meses: string[], m: string): ResumoDoMes {
  const i = meses.indexOf(m);
  const empresaJaTinhaDado = meses.slice(0, i + 1).some((mm) => contas.some((c) => !c.nuncaImportada && c.meses[mm].imp !== "antes"));
  const emUso = contas.filter((c) => (c.nuncaImportada && empresaJaTinhaDado) || (!c.nuncaImportada && c.meses[m].imp !== "antes"));
  const importadas = emUso.filter((c) => !c.nuncaImportada && c.meses[m].imp === "completo").length;
  const pend = contas.reduce((s, c) => s + (c.nuncaImportada ? 0 : c.meses[m].semCategoria), 0);
  const total = contas.reduce((s, c) => s + (c.nuncaImportada ? 0 : c.meses[m].total), 0);
  const comComprovante = contas.reduce((s, c) => s + (c.nuncaImportada ? 0 : c.meses[m].comComprovante ?? 0), 0);
  return { contas: emUso.length, importadas, pend, total, comComprovante, vazio: emUso.length === 0, fechado: emUso.length > 0 && importadas === emUso.length && pend === 0 };
}
