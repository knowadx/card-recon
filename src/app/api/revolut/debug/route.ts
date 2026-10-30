import { getValidAccessToken, REVOLUT_BASE } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";

export const GET = guarded(async (request: Request) => {
  await requireSuperadmin(); // depuração (transações cruas do banco) = só o administrador geral
  const { searchParams } = new URL(request.url);
  const count = parseInt(searchParams.get("count") ?? "5");
  const companyId = searchParams.get("companyId");
  if (!companyId) return Response.json({ error: "?companyId= obrigatório" }, { status: 400 });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(companyId);
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
});
