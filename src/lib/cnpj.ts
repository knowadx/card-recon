/** CNPJ — sem dependência de servidor (a tela de contas e o conector do BTG usam o mesmo). */
export const apenasDigitos = (cnpj: string | null | undefined) => (cnpj ?? "").replace(/\D/g, "");

/** CNPJ com 14 dígitos E dígitos verificadores certos (cadastro errado vira mensagem clara, não erro do BTG). */
export function cnpjValido(cnpj: string | null | undefined): boolean {
  const c = apenasDigitos(cnpj);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...base].reduce((soma, d, i) => soma + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? "0" : String(11 - r);
  };
  return c[12] === dv(c.slice(0, 12)) && c[13] === dv(c.slice(0, 13));
}
