export async function GET() {
  const key = process.env.WISE_API_KEY;
  if (!key) return Response.json({ error: "No key" }, { status: 500 });
  const res = await fetch("https://api.wise.com/v2/profiles", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return Response.json({ error: `Wise error ${res.status}` }, { status: 500 });
  return Response.json(await res.json());
}
