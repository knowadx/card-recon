/**
 * Lançamentos IDÊNTICOS no mesmo arquivo (mesmo dia, valor e descrição — ex.: duas tarifas iguais no mesmo dia)
 * são lançamentos DIFERENTES. Quando o banco não dá um ID, a chave vem dos fatos da linha e as repetidas
 * colidiriam (dono, 2026-11-13: a planilha da Husky deste ano dava "erro interno"; a Dolafy descartava a 2ª em
 * silêncio). Regra única: a 1ª fica com a chave pura (o que já foi importado continua casando) e as seguintes
 * ganham "#2", "#3"… na ordem do arquivo. Estável entre reimportações porque o extrato sempre traz o dia inteiro.
 * Usada por Husky, Dolafy e Payoneer (crédito sem Transaction ID).
 */
export function numerarRepetidas(chaves: string[]): string[] {
  const vistas = new Map<string, number>();
  return chaves.map((c) => {
    const n = (vistas.get(c) ?? 0) + 1;
    vistas.set(c, n);
    return n === 1 ? c : `${c}#${n}`;
  });
}
