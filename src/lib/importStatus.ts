/**
 * Quando um mês pode ser conferido no Fechamento Meta — a regra ÚNICA (decisão do dono em 2026-10-16):
 * o mês já acabou E toda conta de banco já configurada (Mercury/Wise/Revolut) foi sincronizada DEPOIS
 * do último dia dele (Account.syncedThrough, gravado pelo sync que termina). Conta nunca configurada e
 * planilha (Husky) não travam — aparecem no passo 1. Mês bloqueado vem com o motivo.
 */

const SINCRONIZAVEIS = ["Mercury", "Wise", "Revolut"];

export type ContaImportacao = { nome: string; banco: string; configurada: boolean; syncedThrough: Date | null };
export type StatusMes = { liberado: boolean; motivo: string | null };

/** Fim do mês = início do mês seguinte (UTC, como as datas das transações). */
export function fimDoMes(mes: string): Date {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}

const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export function statusDoMes(mes: string, contas: ContaImportacao[], agora: Date = new Date()): StatusMes {
  const fim = fimDoMes(mes);
  if (agora < fim) return { liberado: false, motivo: "o mês ainda não acabou" };
  const pendentes = contas.filter((c) => c.configurada && SINCRONIZAVEIS.includes(c.banco) && (!c.syncedThrough || c.syncedThrough < fim));
  if (pendentes.length === 0) return { liberado: true, motivo: null };
  const ultimoDia = br(new Date(fim.getTime() - 1));
  const quais = pendentes
    .slice(0, 3)
    .map((c) => `${c.banco} · ${c.nome} (${c.syncedThrough ? `sincronizada até ${br(c.syncedThrough)}` : "sync nunca terminou"})`)
    .join(", ");
  const mais = pendentes.length > 3 ? ` e mais ${pendentes.length - 3}` : "";
  return { liberado: false, motivo: `falta sincronizar depois de ${ultimoDia}: ${quais}${mais}` };
}
