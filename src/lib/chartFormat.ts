export type Unit = "currency" | "percentage" | "index" | "time" | "count";
export type Format = "auto" | "thousands" | "millions" | "raw" | "percentage";

export const UNITS: { value: Unit; label: string; suffix: string }[] = [
  { value: "currency", label: "Currency (USD)", suffix: "" },
  { value: "percentage", label: "Percentage (%)", suffix: "%" },
  { value: "index", label: "Index / Ratio", suffix: "" },
  { value: "time", label: "Time (hours)", suffix: "h" },
  { value: "count", label: "Count", suffix: "" },
];

export const FORMATS: { value: Format; label: string }[] = [
  { value: "auto", label: "Auto (K / M)" },
  { value: "thousands", label: "Thousands (K)" },
  { value: "millions", label: "Millions (M)" },
  { value: "raw", label: "Exact number" },
  { value: "percentage", label: "Percentage (×100 %)" },
];

export function formatValue(n: number, unit: Unit, format: Format): string {
  if (n === null || n === undefined || isNaN(n)) return "—";

  let num = n;
  let suffix = UNITS.find(u => u.value === unit)?.suffix ?? "";

  if (format === "percentage") {
    return (num * 100).toFixed(1) + "%";
  }
  if (format === "millions") {
    return (num / 1_000_000).toFixed(1) + "M" + (suffix && suffix !== "%" ? " " + suffix : suffix);
  }
  if (format === "thousands") {
    return (num / 1_000).toFixed(1) + "K" + (suffix && suffix !== "%" ? " " + suffix : suffix);
  }
  if (format === "raw") {
    return num.toLocaleString("en-US", { maximumFractionDigits: 2 }) + (suffix ? " " + suffix : "");
  }

  // auto
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M" + (suffix ? " " + suffix : "");
  if (abs >= 1_000) return (num / 1_000).toFixed(0) + "K" + (suffix ? " " + suffix : "");
  return num.toFixed(unit === "percentage" ? 1 : 0) + (suffix ? " " + suffix : "");
}

export function unitPrefix(unit: Unit): string {
  if (unit === "currency") return "$";
  return "";
}
