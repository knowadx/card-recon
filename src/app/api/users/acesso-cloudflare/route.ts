import { guarded, requireManager } from "@/lib/access";
import { sincronizarAcessoCloudflare } from "@/lib/cloudflareAccess";

export const dynamic = "force-dynamic";

/** GET — a lista da Cloudflare bate com os usuários ativos? Só confere, não grava. */
export const GET = guarded(async () => {
  await requireManager();
  return Response.json(await sincronizarAcessoCloudflare({ aplicar: false }));
});

/** POST — acerta a lista agora (o "tentar de novo" da tela Usuários quando a Cloudflare falhou). */
export const POST = guarded(async () => {
  await requireManager();
  return Response.json(await sincronizarAcessoCloudflare());
});
