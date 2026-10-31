import { prisma } from "@/lib/db";
import { assertAccount, guarded, requireSuperadmin, requireUser } from "@/lib/access";
import { KEY_MAP, listarExtracoesMercury as fetchAccounts } from "@/lib/mercury";

export const GET = guarded(async (request: Request) => {
  const user = await requireUser();
  const accountId = new URL(request.url).searchParams.get("accountId");

  // 1 token por conta: se veio accountId, lista usando o token DAQUELA conta (só se a conta é do escopo)
  if (accountId) {
    await assertAccount(user, accountId);
    const acc = await prisma.account.findUnique({ where: { id: accountId } });
    if (!acc?.apiToken) return Response.json([]);
    // rótulo = nome da CONTA (não da empresa)
    return Response.json(await fetchAccounts(acc.name, acc.apiToken).catch(() => []));
  }

  // Sem accountId: agrega todos os tokens conhecidos (contas + env) — retrocompat.
  // Tokens de TODAS as contas/grupos + chaves globais → só o administrador geral.
  await requireSuperadmin();
  const accountsWithToken = await prisma.account.findMany({
    where: { bank: "Mercury", NOT: { apiToken: null } },
  });
  const sources: Array<{ label: string; key: string }> = [];
  const seen = new Set<string>();
  for (const a of accountsWithToken) {
    if (a.apiToken && !seen.has(a.apiToken)) {
      sources.push({ label: a.name, key: a.apiToken });
      seen.add(a.apiToken);
    }
  }
  for (const [entity, key] of Object.entries(KEY_MAP)) {
    if (key && !seen.has(key)) {
      sources.push({ label: entity, key });
      seen.add(key);
    }
  }
  const results = await Promise.all(sources.map(({ label, key }) => fetchAccounts(label, key).catch(() => [])));
  return Response.json(results.flat());
});
