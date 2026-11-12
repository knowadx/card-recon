import { describe, expect, it } from "vitest";
import { nomeDaConta } from "@/lib/nomeDaConta";

// O filtro de conta mostrava "LinkView OÜ" e "Payonner" duas vezes cada (pedido do dono em 2026-11-12).
const contas = [
  { id: "1", name: "LinkView OÜ", bank: "Wise", currency: "EUR" },
  { id: "2", name: "LinkView OÜ", bank: "Husky", currency: "EUR" },
  { id: "3", name: "Payonner", bank: "Payoneer", currency: "USD" },
  { id: "4", name: "Payonner", bank: "Payoneer", currency: "EUR" },
];

describe("nomeDaConta", () => {
  it("nome + moeda; se ainda repetir, entra o banco", () => {
    expect(contas.map((c) => nomeDaConta(c, contas))).toEqual(["LinkView OÜ · Wise EUR", "LinkView OÜ · Husky EUR", "Payonner USD", "Payonner EUR"]);
  });
});
