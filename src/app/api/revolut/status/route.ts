import { prisma } from "@/lib/db";

export async function GET() {
  const row = await prisma.setting.findUnique({ where: { key: "revolut_refresh_token" } });
  const expRow = await prisma.setting.findUnique({ where: { key: "revolut_access_token_exp" } });
  const connected = !!row?.value;
  const exp = expRow ? parseInt(expRow.value) : 0;
  const now = Math.floor(Date.now() / 1000);
  return Response.json({ connected, tokenExpired: exp < now });
}
