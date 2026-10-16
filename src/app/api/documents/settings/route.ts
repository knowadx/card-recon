import { guarded, requireManager, requireUser } from "@/lib/access";
import { getExpiryWarningDays, readBody, setExpiryWarningDays } from "@/lib/documents";

/** Antecedência do aviso de vencimento (dias). Todos leem; só admins mudam. */
export const GET = guarded(async () => {
  await requireUser();
  return Response.json({ expiryWarningDays: await getExpiryWarningDays() });
});

export const PUT = guarded(async (request: Request) => {
  await requireManager();
  const body = await readBody(request);
  return Response.json({ expiryWarningDays: await setExpiryWarningDays(body.expiryWarningDays) });
});
