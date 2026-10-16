import { randomUUID } from "crypto";
import { AwsClient } from "aws4fetch";

/**
 * Arquivos no Cloudflare R2 (API compatível com S3).
 *
 * O navegador sobe o arquivo DIRETO pro R2 com uma URL pré-assinada (o corpo de request da Vercel
 * trava em ~4,5 MB, então o arquivo não passa pelo servidor). O app só assina URLs curtas,
 * confere que o objeto chegou (HEAD) e serve o download por outra URL assinada de poucos minutos.
 *
 * Sem as 4 variáveis (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) o
 * armazenamento fica DESLIGADO e quem tentar subir/baixar recebe 503 — nunca grava em disco local
 * (no Vercel o disco é apagado e era assim que os anexos se perdiam).
 *
 * No banco, Document.path guarda "r2:<chave>".
 */

export interface StorageConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const R2_PREFIX = "r2:";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB por arquivo
const UPLOAD_TTL = 600; // 10 min para o navegador subir
const DOWNLOAD_TTL = 300; // 5 min para abrir/baixar

export class StorageUnavailable extends Error {
  constructor() {
    super("armazenamento de arquivos não configurado");
  }
}

export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function requireConfig(): StorageConfig {
  const cfg = storageConfig();
  if (!cfg) throw new StorageUnavailable();
  return cfg;
}

function client(cfg: StorageConfig) {
  return new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto" });
}

function objectUrl(cfg: StorageConfig, key: string): URL {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${path}`);
}

/** Nome de arquivo seguro: sem pasta, sem caracteres estranhos, no máximo 120 caracteres. */
export function safeFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^[.\s_]+/, "")
    .trim()
    .slice(-120);
  return cleaned || "arquivo";
}

/**
 * Chave do objeto: <escopo>/<aaaa>/<mm>/<uuid>-<nome>. O escopo é montado pelo SERVIDOR
 * (ex.: "tx/<transactionId>"), nunca vem do cliente — assim dá pra conferir depois a quem pertence.
 */
export function buildKey(scope: string, filename: string, now = new Date(), id: string = randomUUID()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${scope}/${yyyy}/${mm}/${id}-${safeFilename(filename)}`;
}

/** URL para o navegador fazer PUT do arquivo. O Content-Type entra na assinatura: tem que bater. */
export async function presignUpload(key: string, contentType: string): Promise<string> {
  const cfg = requireConfig();
  const url = objectUrl(cfg, key);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL));
  const signed = await client(cfg).sign(
    new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
    // allHeaders: por padrão o aws4fetch não assina content-type; aqui assina (o upload tem que bater)
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url;
}

/** URL de poucos minutos para abrir (inline) ou baixar o arquivo. */
export async function presignDownload(key: string, filename: string): Promise<string> {
  const cfg = requireConfig();
  const url = objectUrl(cfg, key);
  url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_TTL));
  url.searchParams.set("response-content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(safeFilename(filename))}`);
  const signed = await client(cfg).sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

/** O objeto existe? Devolve tamanho e tipo (null se não existe). */
export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  const cfg = requireConfig();
  const res = await client(cfg).fetch(objectUrl(cfg, key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD falhou: ${res.status}`);
  return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
}

export async function deleteObject(key: string): Promise<void> {
  const cfg = requireConfig();
  const res = await client(cfg).fetch(objectUrl(cfg, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE falhou: ${res.status}`);
}
