interface WiseProfile {
  id: number;
  type: string;
  fullName?: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
}

export async function GET() {
  const key = process.env.WISE_API_KEY;
  if (!key) return Response.json({ error: "WISE_API_KEY not set" }, { status: 500 });

  const res = await fetch("https://api.wise.com/v2/profiles", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return Response.json({ error: `Wise error ${res.status}` }, { status: 500 });

  const profiles: WiseProfile[] = await res.json();
  const business = profiles
    .filter((p) => p.type === "BUSINESS")
    .map((p) => ({
      id: String(p.id),
      label: p.fullName ?? p.businessName ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    }));

  return Response.json(business);
}
