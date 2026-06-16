import { prisma } from "@/lib/db";
import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const count = parseInt(searchParams.get("count") ?? "5");

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(prisma);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 401 });
  }

  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const url = new URL(`${REVOLUT_BASE}/transactions`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("count", String(count));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const raw = await res.json();
  return Response.json(raw, { status: res.ok ? 200 : 502 });
}
