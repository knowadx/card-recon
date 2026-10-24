/**
 * Leitura de extrato OFX (1.x SGML e 2.x XML) — genérica, pra qualquer banco sem API (pedido do dono em
 * 2026-10-24, começando pela XP Empresas: o OFX traz FITID por lançamento e a conta do arquivo, coisas
 * que o CSV da XP não traz). Medido no OFX real da XP: SGML 102, tags com fechamento, data só AAAAMMDD,
 * valor "-115.00", e o cabeçalho diz CHARSET:1252 mas o conteúdo é UTF-8 (quem lê o arquivo decide —
 * ver decodificarOfx na tela).
 */
export type LancamentoOfx = { fitid: string; data: Date; valor: number; descricao: string; tipo: string | null };
export type ExtratoOfx = {
  banco: string | null; // BANKID (ex.: 348 = Banco XP)
  agencia: string | null;
  conta: string; // ACCTID
  moeda: string | null; // CURDEF
  inicio: Date | null;
  fim: Date | null;
  saldo: number | null; // LEDGERBAL
  lancamentos: LancamentoOfx[];
};

const folha = (bloco: string, tag: string) => {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
};

/** AAAAMMDD[HHMMSS[.xxx]][[-3:BRT]] → Date. Sem hora = meio-dia UTC (o dia não muda em nenhum fuso do Brasil). */
export function dataOfx(bruto: string | null): Date | null {
  const m = bruto?.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?(?:\.\d+)?(?:\[([+-]?\d+(?:\.\d+)?)(?::[^\]]*)?\])?/);
  if (!m) return null;
  const [, a, me, d, h, mi, s, fuso] = m;
  if (!h) return new Date(`${a}-${me}-${d}T12:00:00Z`);
  const off = fuso ? Number(fuso) : 0; // OFX: sem fuso = GMT
  const sinal = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const offTxt = `${sinal}${String(Math.floor(abs)).padStart(2, "0")}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")}`;
  const data = new Date(`${a}-${me}-${d}T${h}:${mi}:${s ?? "00"}${offTxt}`);
  return Number.isNaN(data.getTime()) ? null : data;
}

const numero = (bruto: string | null) => {
  if (!bruto) return null;
  const n = Number(bruto.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function lerOfx(texto: string): { extrato?: ExtratoOfx; erro?: string } {
  if (!/<OFX>/i.test(texto)) return { erro: "isso não é um arquivo OFX" };
  const contaBloco = texto.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/\1>/i)?.[2] ?? texto;
  const conta = folha(contaBloco, "ACCTID");
  if (!conta) return { erro: "o OFX não diz de qual conta é (sem ACCTID)" };

  const lancamentos: LancamentoOfx[] = [];
  let semId = 0;
  // cada <STMTTRN>… até o fechamento (ou o próximo, no SGML sem fechamento)
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0])) {
    const fitid = folha(bloco, "FITID");
    const data = dataOfx(folha(bloco, "DTPOSTED"));
    const valor = numero(folha(bloco, "TRNAMT"));
    if (!fitid || !data || valor === null) { semId++; continue; }
    const nome = folha(bloco, "NAME");
    const memo = folha(bloco, "MEMO");
    const descricao = [nome, memo].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" — ") || "lançamento";
    lancamentos.push({ fitid, data, valor, descricao, tipo: folha(bloco, "TRNTYPE") });
  }
  if (!lancamentos.length) return { erro: semId ? `nenhum lançamento válido (${semId} sem FITID/data/valor)` : "o OFX não tem lançamentos no período" };

  return {
    extrato: {
      banco: folha(contaBloco, "BANKID"),
      agencia: folha(contaBloco, "BRANCHID"),
      conta,
      moeda: folha(texto, "CURDEF"),
      inicio: dataOfx(folha(texto, "DTSTART")),
      fim: dataOfx(folha(texto, "DTEND")),
      saldo: numero(folha(texto.match(/<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i)?.[1] ?? "", "BALAMT")),
      lancamentos,
    },
  };
}
