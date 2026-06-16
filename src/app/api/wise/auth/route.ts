import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.WISE_CLIENT_ID;
  const redirectUri = process.env.WISE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return Response.json({ error: "WISE_CLIENT_ID or WISE_REDIRECT_URI not set" }, { status: 500 });
  }

  const state = randomBytes(16).toString("hex");

  const url = new URL("https://wise.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("oauth_state_wise", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
