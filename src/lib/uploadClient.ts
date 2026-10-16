/**
 * Envio de arquivo pelo navegador — o MESMO caminho pra anexo de transação e documento da empresa:
 * 1) pede a URL assinada, 2) sobe direto pro R2, 3) o servidor confere e registra.
 * Erros viram Error com a mensagem da API (pra mostrar na tela).
 */
export type UploadOwner = { companyId: string } | { transactionId: string };

async function apiError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || `${fallback} (${res.status})`);
}

export async function uploadDocument(file: File, owner: UploadOwner, meta: Record<string, unknown> = {}) {
  const contentType = file.type || "application/octet-stream";
  const json = { "Content-Type": "application/json" };

  const start = await fetch("/api/documents/upload", {
    method: "POST", headers: json,
    body: JSON.stringify({ ...owner, filename: file.name, contentType, size: file.size }),
  });
  if (!start.ok) throw await apiError(start, "não foi possível iniciar o envio");
  const { key, uploadUrl } = (await start.json()) as { key: string; uploadUrl: string };

  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (!put.ok) throw new Error(`o armazenamento recusou o arquivo (${put.status})`);

  const done = await fetch("/api/documents", {
    method: "POST", headers: json,
    body: JSON.stringify({ ...owner, ...meta, key, filename: file.name }),
  });
  if (!done.ok) throw await apiError(done, "não foi possível registrar o documento");
  return done.json();
}
