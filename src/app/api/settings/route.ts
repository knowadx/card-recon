import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getAllSettings();
  return NextResponse.json({
    tolerancePct: s["recon.tolerancePct"] ?? "0.02",
    metaMerchantPattern: s["recon.metaMerchantPattern"] ?? "facebook|facebk|meta\\s*platform|meta\\s*ads|meta\\b",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.tolerancePct != null) await setSetting("recon.tolerancePct", String(body.tolerancePct));
    if (body.metaMerchantPattern != null) await setSetting("recon.metaMerchantPattern", String(body.metaMerchantPattern));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
