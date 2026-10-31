import { describe, expect, it } from "vitest";
import { fimDoMes, statusDoMes } from "@/lib/importStatus";
import { mesclar, type Trecho } from "@/lib/cobertura";

// Regra do Fechamento Meta: só confere mês com a importação terminada (decisão do dono em 2026-10-16) —
// desde 2026-10-30, "terminada" = o mês INTEIRO coberto (src/lib/cobertura.ts), não "sincronizada depois do fim".
const d = (s: string) => new Date(s);
const t = (de: string, ate: string): Trecho => ({ de: d(de), ate: d(ate) });
const conta = (banco: string, trechos: Trecho[], configurada = true) => ({ nome: `${banco} X`, banco, configurada, cobertura: mesclar(trechos) });

describe("statusDoMes", () => {
  it("fim do mês = começo do mês seguinte (UTC)", () => {
    expect(fimDoMes("2026-09").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(fimDoMes("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("mês que ainda não acabou nunca libera", () => {
    expect(statusDoMes("2026-10", [conta("Wise", [t("2026-01-01", "2026-10-16T12:00:00Z")])], d("2026-10-16T12:00:00Z"))).toEqual({ liberado: false, motivo: "o mês ainda não acabou" });
  });

  it("libera quando toda conta configurada tem o mês INTEIRO coberto", () => {
    const contas = [conta("Wise", [t("2026-09-01", "2026-10-02")]), conta("Revolut", [t("2026-08-15", "2026-09-10"), t("2026-09-10", "2026-10-16")])];
    expect(statusDoMes("2026-09", contas, d("2026-10-16T12:00:00Z")).liberado).toBe(true);
  });

  it("sincronizada DEPOIS do fim mas começando no meio do mês NÃO libera (o antigo 'sincronizada até' liberava)", () => {
    const st = statusDoMes("2026-09", [conta("Mercury", [t("2026-09-05", "2026-10-16")])], d("2026-10-16T12:00:00Z"));
    expect(st.liberado).toBe(false);
    expect(st.motivo).toContain("Mercury · Mercury X (importada até 15/10/2026)");
  });

  it("conta coberta só em parte, ou sem importação registrada, trava — com o motivo", () => {
    const st = statusDoMes("2026-09", [conta("Wise", [t("2026-08-01", "2026-09-29T10:00:00Z")]), conta("Revolut", []), conta("BTG", [t("2026-01-01", "2026-10-10")])], d("2026-10-16T12:00:00Z"));
    expect(st.liberado).toBe(false);
    expect(st.motivo).toContain("falta importar o mês inteiro");
    expect(st.motivo).toContain("Wise · Wise X (importada até 29/09/2026)");
    expect(st.motivo).toContain("Revolut · Revolut X (nenhuma importação completa registrada)");
    expect(st.motivo).not.toContain("BTG");
  });

  it("conta nunca configurada e planilha (Husky) não travam", () => {
    const contas = [conta("Wise", [], false), conta("Husky", [], true), conta("Revolut", [t("2026-09-01", "2026-10-05")])];
    expect(statusDoMes("2026-09", contas, d("2026-10-16T12:00:00Z")).liberado).toBe(true);
  });
});
