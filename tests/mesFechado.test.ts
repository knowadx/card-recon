import { describe, expect, it } from "vitest";
import { resumoDoMes, type ContaDaEmpresa, type EstadoImp } from "@/lib/mesFechado";

// "Mês fechado" (decisão do dono em 2026-11-12) = todas as contas importadas do 1º ao último dia E nada sem categoria.
const MESES = ["2026-08", "2026-09", "2026-10"];
const conta = (estados: Array<[EstadoImp, number, number]>, nuncaImportada = false): ContaDaEmpresa => ({
  nuncaImportada,
  meses: Object.fromEntries(MESES.map((m, i) => [m, { imp: estados[i][0], total: estados[i][1], semCategoria: estados[i][2] }])),
});

describe("resumoDoMes (mês fechado da empresa)", () => {
  it("fecha só com as duas coisas: todas as contas importadas E nenhum pendente", () => {
    const a = conta([["completo", 10, 0], ["completo", 8, 2], ["parcial", 5, 0]]);
    const b = conta([["completo", 0, 0], ["completo", 3, 0], ["completo", 1, 0]]);
    expect(resumoDoMes([a, b], MESES, "2026-08")).toMatchObject({ contas: 2, importadas: 2, pend: 0, fechado: true });
    expect(resumoDoMes([a, b], MESES, "2026-09")).toMatchObject({ importadas: 2, pend: 2, fechado: false }); // importado, mas 2 sem categoria
    expect(resumoDoMes([a, b], MESES, "2026-10")).toMatchObject({ importadas: 1, contas: 2, pend: 0, fechado: false }); // categorizado, mas uma conta só em parte
  });

  it("mês importado sem nenhum lançamento fecha (não há o que categorizar)", () => {
    expect(resumoDoMes([conta([["completo", 0, 0], ["completo", 0, 0], ["completo", 0, 0]])], MESES, "2026-08")).toMatchObject({ total: 0, fechado: true });
  });

  it("lançamento sem importação registrada (sem comprovação) não fecha, mesmo todo categorizado", () => {
    expect(resumoDoMes([conta([["sem_comprovacao", 4, 0], ["completo", 1, 0], ["completo", 1, 0]])], MESES, "2026-08")).toMatchObject({ importadas: 0, contas: 1, fechado: false });
  });

  it("conta que ainda não tinha dado no mês não conta; conta NUNCA importada trava a partir do 1º dado da empresa", () => {
    const nova = conta([["antes", 0, 0], ["completo", 2, 0], ["completo", 2, 0]]);
    const velha = conta([["completo", 1, 0], ["completo", 1, 0], ["completo", 1, 0]]);
    expect(resumoDoMes([nova, velha], MESES, "2026-08")).toMatchObject({ contas: 1, fechado: true }); // a nova ainda não existia
    const esquecida = conta([["antes", 0, 0], ["antes", 0, 0], ["antes", 0, 0]], true);
    expect(resumoDoMes([velha, esquecida], MESES, "2026-08")).toMatchObject({ contas: 2, importadas: 1, fechado: false });
    // empresa sem nenhum dado ainda: nada a fechar (vazio), nem a conta esquecida pesa
    expect(resumoDoMes([conta([["antes", 0, 0], ["antes", 0, 0], ["completo", 1, 0]]), esquecida], MESES, "2026-08")).toMatchObject({ vazio: true, fechado: false });
  });
});
