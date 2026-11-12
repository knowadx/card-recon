/**
 * Nome de uma conta em listas e colunas: nome + moeda ("Payonner USD"); se ainda repetir entre as contas
 * da lista, entra o banco ("LinkView OÜ · Wise EUR"). Pedido do dono em 2026-11-12 ("muda essa account pra
 * aparecer o nome da conta + moeda") — o filtro mostrava "LinkView OÜ" e "Payonner" duas vezes cada.
 */
type ContaNomeavel = { id: string; name: string; bank: string; currency: string };

export function nomeDaConta(conta: ContaNomeavel, todas: ContaNomeavel[]): string {
  const base = (c: ContaNomeavel) => `${c.name.trim()} ${c.currency}`.toLowerCase();
  const repete = todas.some((o) => o.id !== conta.id && base(o) === base(conta));
  return repete ? `${conta.name.trim()} · ${conta.bank} ${conta.currency}` : `${conta.name.trim()} ${conta.currency}`;
}
