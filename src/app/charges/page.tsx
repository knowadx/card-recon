import { prisma } from "@/lib/db";
import { money } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ISSUERS = ["", "mercury", "wise", "revolut"];

export default async function ChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ issuer?: string; meta?: string }>;
}) {
  const sp = await searchParams;
  const issuer = sp.issuer ?? "";
  const onlyMeta = sp.meta !== "0"; // default: só Meta

  const where: Record<string, unknown> = {};
  if (issuer) where.issuer = issuer;
  if (onlyMeta) where.isMetaCharge = true;

  const charges = await prisma.bankCharge.findMany({
    where,
    orderBy: { date: "desc" },
    take: 500,
  });
  const total = charges.reduce((s, c) => s + Math.abs(c.amount), 0);

  function link(params: Record<string, string>) {
    const u = new URLSearchParams({ issuer, meta: onlyMeta ? "1" : "0", ...params });
    return `/charges?${u.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Cobranças ({charges.length}{charges.length === 500 ? "+" : ""})</h1>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Banco:</span>
        {ISSUERS.map((iss) => (
          <Link
            key={iss || "all"}
            href={link({ issuer: iss })}
            className={`rounded-md border px-2 py-1 ${issuer === iss ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white"}`}
          >
            {iss || "todos"}
          </Link>
        ))}
        <span className="ml-3 text-slate-500">|</span>
        <Link
          href={link({ meta: onlyMeta ? "0" : "1" })}
          className={`rounded-md border px-2 py-1 ${onlyMeta ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white"}`}
        >
          {onlyMeta ? "só Meta ✓" : "todas"}
        </Link>
        <span className="ml-auto text-slate-600">Total: <strong className="tabular-nums">{money(total)}</strong></span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Banco / Empresa</th>
              <th className="px-3 py-2">Merchant</th>
              <th className="px-3 py-2">Cartão</th>
              <th className="px-3 py-2">Meta?</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {charges.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 tabular-nums">{c.date.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">
                  {c.issuer}
                  {c.company && c.company !== "default" && <span className="text-slate-400"> · {c.company}</span>}
                </td>
                <td className="px-3 py-2">{c.merchantRaw ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{c.cardLast4 ? `•••• ${c.cardLast4}` : <span className="text-slate-400">sem cartão</span>}</td>
                <td className="px-3 py-2">{c.isMetaCharge ? "✅" : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(Math.abs(c.amount), c.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {charges.length === 0 && <p className="text-slate-500">Nenhuma cobrança com esse filtro.</p>}
    </div>
  );
}
