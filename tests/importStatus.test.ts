import { describe, expect, it } from "vitest";
import { fimDoMes, statusDoMes } from "@/lib/importStatus";

// Regra do Fechamento Meta: só confere mês com a importação terminada (decisão do dono em 2026-10-16).
const d = (s: string) => new Date(s);
const conta = (banco: string, syncedThrough: string | null, configurada = true) => ({ nome: `${banco} X`, banco, configurada, syncedThrough: syncedThrough ? d(syncedThrough) : null });

describe("statusDoMes", () => {
  it("fim do mês = começo do mês seguinte (UTC)", () => {
    expect(fimDoMes("2026-09").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(fimDoMes("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("mês que ainda não acabou nunca libera", () => {
    expect(statusDoMes("2026-10", [conta("Wise", "2026-10-16T12:00:00Z")], d("2026-10-16T12:00:00Z"))).toEqual({ liberado: false, motivo: "o mês ainda não acabou" });
  });

  it("libera quando toda conta configurada foi sincronizada DEPOIS do fim do mês", () => {
    const contas = [conta("Wise", "2026-10-02T00:00:00Z"), conta("Revolut", "2026-10-16T00:00:00Z")];
    expect(statusDoMes("2026-09", contas, d("2026-10-16T12:00:00Z")).liberado).toBe(true);
  });

  it("uma conta sincronizada antes do fim (ou que nunca terminou) trava, com o motivo", () => {
    const st = statusDoMes("2026-09", [conta("Wise", "2026-09-29T10:00:00Z"), conta("Revolut", null), conta("Mercury", "2026-10-10T00:00:00Z")], d("2026-10-16T12:00:00Z"));
    expect(st.liberado).toBe(false);
    expect(st.motivo).toContain("falta sincronizar depois de 30/09/2026");
    expect(st.motivo).toContain("Wise · Wise X (sincronizada até 29/09/2026)");
    expect(st.motivo).toContain("Revolut · Revolut X (sync nunca terminou)");
    expect(st.motivo).not.toContain("Mercury");
  });

  it("conta nunca configurada e planilha (Husky) não travam", () => {
    const contas = [conta("Wise", null, false), conta("Husky", null, true), conta("Revolut", "2026-10-05T00:00:00Z")];
    expect(statusDoMes("2026-09", contas, d("2026-10-16T12:00:00Z")).liberado).toBe(true);
  });
});
