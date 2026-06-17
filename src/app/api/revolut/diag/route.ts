import { buildJwt } from "@/lib/revolut";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/revolut/diag — confirma que a chave assina o JWT em produção (admin). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });

  const hasEnv = !!process.env.REVOLUT_PRIVATE_KEY;
  const origin = new URL(request.url).origin;
  const redirect = `${origin}/api/revolut/callback`;
  try {
    const jwt = buildJwt("DIAG_CLIENT", redirect);
    const [h, p] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    return Response.json({
      ok: true,
      keyFromEnv: hasEnv,
      jwtHeader: header,
      iss: payload.iss,
      sub: payload.sub,
      sigLen: jwt.split(".")[2].length,
    });
  } catch (e) {
    return Response.json({ ok: false, keyFromEnv: hasEnv, error: (e as Error).message }, { status: 500 });
  }
}
