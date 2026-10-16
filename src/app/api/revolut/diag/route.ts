import { buildJwt } from "@/lib/revolut";
import { guarded, requireSuperadmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** GET /api/revolut/diag — confirma que a chave assina o JWT em produção (admin). */
export const GET = guarded(async (request: Request) => {
  await requireSuperadmin();

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
});
