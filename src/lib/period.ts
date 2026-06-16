import { startOfMonth, endOfMonth, format, parse } from "date-fns";

export interface Period {
  key: string; // "2026-06"
  start: Date;
  end: Date;
  since: string; // "2026-06-01"
  until: string; // "2026-06-30"
}

/** Resolve um período "YYYY-MM" (default: mês corrente) em datas + strings. */
export function resolvePeriod(periodKey?: string | null): Period {
  const base = periodKey
    ? parse(periodKey, "yyyy-MM", new Date())
    : new Date();
  const start = startOfMonth(base);
  const end = endOfMonth(base);
  return {
    key: format(start, "yyyy-MM"),
    start,
    end,
    since: format(start, "yyyy-MM-dd"),
    until: format(end, "yyyy-MM-dd"),
  };
}
