import { coberturaDoMes, cobertaAte, fimDoMes, type Trecho } from "./cobertura";

/**
 * Quando um mês pode ser conferido no Fechamento Meta — a regra ÚNICA (decisão do dono em 2026-10-16):
 * o mês já acabou E toda conta de banco já configurada pra API (Mercury/Wise/Revolut/BTG) tem o mês
 * INTEIRO importado (cobertura, src/lib/cobertura.ts — desde 2026-10-30; antes era "sincronizada depois
 * do fim do mês", que não dizia desde quando). Conta nunca configurada e planilha (Husky) não travam —
 * aparecem no passo 1. Mês bloqueado vem com o motivo.
 */

/** Bancos que sincronizam por API (fonte ÚNICA — o Fechamento também usa). Husky/Dolafy = manual. */
export const SINCRONIZAVEIS = ["Mercury", "Wise", "Revolut", "BTG"];

export { fimDoMes };
export type ContaImportacao = { nome: string; banco: string; configurada: boolean; cobertura: Trecho[] }; // cobertura MESCLADA
export type StatusMes = { liberado: boolean; motivo: string | null };

const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export function statusDoMes(mes: string, contas: ContaImportacao[], agora: Date = new Date()): StatusMes {
  const fim = fimDoMes(mes);
  if (agora < fim) return { liberado: false, motivo: "o mês ainda não acabou" };
  const pendentes = contas.filter((c) => c.configurada && SINCRONIZAVEIS.includes(c.banco) && coberturaDoMes(c.cobertura, mes).estado !== "completo");
  if (pendentes.length === 0) return { liberado: true, motivo: null };
  const quais = pendentes
    .slice(0, 3)
    .map((c) => {
      const ate = cobertaAte(c.cobertura);
      return `${c.banco} · ${c.nome} (${ate ? `importada até ${br(ate)}` : "nenhuma importação completa registrada"})`;
    })
    .join(", ");
  const mais = pendentes.length > 3 ? ` e mais ${pendentes.length - 3}` : "";
  return { liberado: false, motivo: `falta importar o mês inteiro: ${quais}${mais}` };
}
