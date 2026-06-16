export function money(n: number, currency?: string | null): string {
  const v = n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${v}` : v;
}

export const STATUS_META: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  ok: { label: "OK", cls: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  divergence: { label: "Divergência", cls: "text-amber-800 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  unregistered: { label: "Cartão fora do registro", cls: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-600" },
  unmatched_charge: { label: "Sem conta Meta", cls: "text-slate-600 bg-slate-50 border-slate-200", dot: "bg-slate-400" },
  no_charge: { label: "Sem cobrança", cls: "text-slate-600 bg-slate-50 border-slate-200", dot: "bg-slate-400" },
};
