import { prisma } from "@/lib/db";
import { guarded, requireManager } from "@/lib/access";

const WISE_BASE = "https://api.wise.com";

function monthsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return result;
}

// Busca câmbio na Wise e grava (configuração global): superadmin e admins.
export const POST = guarded(async (request: Request) => {
  await requireManager();
  const body = await request.json() as { currencies?: string[]; from: string; to: string };
  const { from, to } = body;
  const currencies = (body.currencies ?? ["EUR", "BRL", "CAD"]).filter(c => c !== "USD");

  // Cotação é dado público da Wise: serve qualquer chave Wise válida. Antes só lia a chave GLOBAL do
  // .env (que não existe no servidor) e o câmbio nunca era preenchido — agora usa a já guardada no
  // banco (chave de uma conta Wise ou credencial Wise). A chave nunca sai do servidor.
  // `||` (não `??`): no .env do servidor essas chaves existem VAZIAS — vazio tem que cair pra próxima
  const key =
    process.env.WISE_API_KEY ||
    process.env.WISE_API_KEY_ACTIVEVIEW_LLC ||
    (await prisma.account.findFirst({ where: { bank: "Wise", apiToken: { not: null }, NOT: { apiToken: "" } }, select: { apiToken: true } }))?.apiToken ||
    (await prisma.credential.findFirst({ where: { issuer: "wise", isActive: true, NOT: { token: "" } }, select: { token: true } }))?.token;
  if (!key) return Response.json({ error: "nenhuma chave Wise no sistema (cadastre uma conta Wise com chave)" }, { status: 500 });

  const months = monthsBetween(from, to);
  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];

  // Build all jobs upfront and run in parallel (batches of 20)
  type Job = { currency: string; month: string };
  const jobs: Job[] = currencies.flatMap(currency =>
    months.map(month => ({ currency, month }))
  );

  const BATCH = 20;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ currency, month }) => {
      const time = `${month}-01T12:00:00Z`;
      try {
        const res = await fetch(
          `${WISE_BASE}/v1/rates?source=${currency}&target=USD&time=${encodeURIComponent(time)}`,
          { headers: { Authorization: `Bearer ${key}` } }
        );

        const text = await res.text();
        if (!res.ok) {
          failed++;
          if (errors.length < 3) errors.push(`${currency}/${month}: HTTP ${res.status} — ${text.slice(0, 100)}`);
          return;
        }

        const data = JSON.parse(text) as Array<{ rate: number }>;
        const rate = Array.isArray(data) ? data[0]?.rate : null;
        if (!rate) {
          failed++;
          if (errors.length < 3) errors.push(`${currency}/${month}: no rate in response — ${text.slice(0, 100)}`);
          return;
        }

        await prisma.exchangeRate.upsert({
          where: { currency_month: { currency, month } },
          create: { id: `${currency}_${month}`, currency, month, rateToUsd: rate },
          update: { rateToUsd: rate },
        });
        fetched++;
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(`${currency}/${month}: ${String(e)}`);
      }
    }));
  }

  return Response.json({ fetched, failed, errors, total: jobs.length });
});
