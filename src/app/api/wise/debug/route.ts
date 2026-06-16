const WISE_BASE = "https://api.wise.com";

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text || text.trim() === "") return { _empty: true, status: res.status };
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 500), status: res.status }; }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profileId");
    const count = parseInt(searchParams.get("count") ?? "10");
    const search = searchParams.get("search"); // filter activities by title
    const since = searchParams.get("since"); // e.g. 2026-01-01
    const until = searchParams.get("until"); // e.g. 2026-06-01

    const key = process.env.WISE_API_KEY ?? process.env.WISE_API_KEY_ACTIVEVIEW_LLC;
    if (!key) return Response.json({ error: "No WISE_API_KEY found", keys: Object.keys(process.env).filter(k => k.includes("WISE")) }, { status: 500 });

    const headers = { Authorization: `Bearer ${key}` };

    // 1. Activities
    const actUrl = new URL(`${WISE_BASE}/v1/profiles/${profileId}/activities`);
    actUrl.searchParams.set("size", String(count));
    if (since) actUrl.searchParams.set("since", `${since}T00:00:00.000Z`);
    if (until) actUrl.searchParams.set("until", `${until}T23:59:59.999Z`);
    const actRes = await fetch(actUrl.toString(), { headers });
    const actData = await safeJson(actRes) as Record<string, unknown>;
    let activities = (Array.isArray(actData?.activities) ? actData.activities : Array.isArray(actData) ? actData : []) as Array<Record<string, unknown>>;
    if (search) activities = activities.filter(a => String(a.title ?? "").toLowerCase().includes(search.toLowerCase()));

    // Also fetch borderless account recipientId for direction context
    const baRes = await fetch(`${WISE_BASE}/v1/borderless-accounts?profileId=${profileId}`, { headers });
    const baData = await safeJson(baRes) as Array<{ recipientId: number }> | null;
    const ownRecipientId = Array.isArray(baData) ? (baData[0]?.recipientId ?? null) : null;

    // 2. For each TRANSFER activity: fetch transfer (v1) + quote
    const details = await Promise.all(
      activities.slice(0, count).map(async (a) => {
        const resource = a.resource as { type: string; id: string } | undefined;
        if (resource?.type?.toUpperCase() !== "TRANSFER") return { activity: a };

        // GET /v1/transfers/{transferId}
        const tRes = await fetch(`${WISE_BASE}/v1/transfers/${resource.id}`, { headers });
        const transfer = await safeJson(tRes) as Record<string, unknown>;

        // GET /v3/profiles/{profileId}/quotes/{quoteUuid}
        let quote = null;
        const quoteUuid = transfer?.quoteUuid;
        if (quoteUuid) {
          const qRes = await fetch(`${WISE_BASE}/v3/profiles/${profileId}/quotes/${quoteUuid}`, { headers });
          quote = await safeJson(qRes);
        }

        return { activity: a, transfer: { status: tRes.status, data: transfer }, quote };
      })
    );

    return Response.json({ activitiesStatus: actRes.status, ownRecipientId, details });
  } catch (e) {
    return Response.json({ error: String(e), stack: e instanceof Error ? e.stack : undefined }, { status: 500 });
  }
}
