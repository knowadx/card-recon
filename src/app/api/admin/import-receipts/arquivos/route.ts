import { NextResponse } from "next/server";
import { AccessError, RequestError, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { StorageUnavailable, presignUpload } from "@/lib/storage";
import { chaveFaturaMeta, idMetaValido } from "@/lib/faturasMeta";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/import-receipts/arquivos { ids: string[] } — URLs pra o navegador subir os PDFs
 * das faturas da Meta direto pro R2 (nome fixo por id da transação da Meta). Mesmo acesso da
 * importação das faturas: superadmin e admins. Até 300 por pedido.
 */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores importam as faturas (PDFs)");
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
  if (!ids.length || ids.length > 300) throw new RequestError(400, "mande de 1 a 300 ids");
  if (!ids.every(idMetaValido)) throw new RequestError(400, "id de transação da Meta inválido");
  try {
    const urls: Record<string, string> = {};
    for (const id of ids) urls[id] = await presignUpload(chaveFaturaMeta(id), "application/pdf");
    return NextResponse.json({ urls });
  } catch (e) {
    if (e instanceof StorageUnavailable) throw new RequestError(503, "armazenamento de arquivos não configurado");
    throw e;
  }
});
