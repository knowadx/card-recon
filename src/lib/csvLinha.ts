/** Uma linha de CSV com aspas (vírgula dentro de aspas não separa; "" = aspa); campos aparados. Usada por Payoneer e Husky. */
export function camposCsv(linha: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === "," && !aspas) {
      out.push(atual); atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out.map((x) => x.trim());
}
