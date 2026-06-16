import { prisma } from "@/lib/db";
import { getValidWiseToken } from "@/lib/wise";

export async function GET() {
  try {
    await getValidWiseToken(prisma);
    return Response.json({ connected: true });
  } catch {
    return Response.json({ connected: false });
  }
}
