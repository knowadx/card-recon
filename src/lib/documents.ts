import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { AccessError, RequestError, assertCompany, assertTransaction, companyScope, transactionScope, type AppUser } from "./access";
import { isSuperadmin } from "./auth";
import { getSetting, setSetting } from "./settings";
import { MAX_UPLOAD_BYTES, R2_PREFIX, StorageUnavailable, buildKey, deleteObject, headObject, presignUpload } from "./storage";

/**
 * Documentos — a peça ÚNICA de regra para os dois tipos de arquivo do app:
 *  - anexo de transação (comprovante, fatura);
 *  - documento da empresa (contrato social, certidão, IR…), com tipo, validade e renovação.
 *
 * Upload em 2 passos, igual para os dois: o servidor assina uma URL (startUpload), o navegador
 * sobe DIRETO pro R2, e o servidor confere que o arquivo chegou antes de registrar (createDocument).
 * A chave do arquivo leva o dono (`co/<empresa>` ou `tx/<transação>`), montada aqui — nunca pelo cliente.
 *
 * Permissão (decisão do dono em 2026-10-16): quem é do grupo sobe, renova e edita; só admin apaga.
 */

export const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export type DocumentOwner = { companyId: string } | { transactionId: string };
export type DocStatus = "vigente" | "vencendo" | "vencido" | "sem_validade" | "substituido";
export const STATUS_FILTERS = ["vigente", "vencendo", "vencido", "sem_validade", "substituido", "alerta"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

// ── configuração: antecedência do aviso ──────────────────────────────────────

export const EXPIRY_WARNING_KEY = "documents.expiryWarningDays";
const EXPIRY_WARNING_DEFAULT = 30; // valor inicial (decisão do dono em 2026-10-16); muda na tela de tipos

export async function getExpiryWarningDays(): Promise<number> {
  const v = await getSetting(EXPIRY_WARNING_KEY);
  const n = v === null ? NaN : Number(v); // Number(null) = 0: sem a checagem, "não configurado" viraria 0 dias
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : EXPIRY_WARNING_DEFAULT;
}

export async function setExpiryWarningDays(value: unknown): Promise<number> {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 365) throw new RequestError(400, "antecedência do aviso: número inteiro de 0 a 365 dias");
  await setSetting(EXPIRY_WARNING_KEY, String(n));
  return n;
}

// ── datas e status ───────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "Hoje" no fuso de quem usa o app (São Paulo), como AAAA-MM-DD. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Vale ATÉ o dia de vencimento, inclusive; vencido a partir do dia seguinte. */
export function documentStatus(
  doc: { expiresAt: Date | null; replacedBy?: { id: string } | null },
  hoje: string,
  warnDays: number,
): DocStatus {
  if (doc.replacedBy) return "substituido";
  if (!doc.expiresAt) return "sem_validade";
  const exp = dayOf(doc.expiresAt);
  if (exp < hoje) return "vencido";
  if (exp <= addDays(hoje, warnDays)) return "vencendo";
  return "vigente";
}

/** O mesmo critério de documentStatus, como filtro do banco (só documentos atuais, exceto "substituido"). */
export function statusWhere(status: StatusFilter, hoje: string, warnDays: number): Prisma.DocumentWhereInput {
  const limite = asDate(addDays(hoje, warnDays));
  const atual: Prisma.DocumentWhereInput = { replacedBy: { is: null } };
  switch (status) {
    case "substituido": return { replacedBy: { isNot: null } };
    case "sem_validade": return { ...atual, expiresAt: null };
    case "vencido": return { ...atual, expiresAt: { lt: asDate(hoje) } };
    case "vencendo": return { ...atual, expiresAt: { gte: asDate(hoje), lte: limite } };
    case "alerta": return { ...atual, expiresAt: { lte: limite } };
    case "vigente": return { ...atual, expiresAt: { gt: limite } };
  }
}

// ── escopo ───────────────────────────────────────────────────────────────────

/** Documentos visíveis: de empresa visível OU anexados a transação visível. */
export async function documentScope(user: AppUser): Promise<Prisma.DocumentWhereInput> {
  if (isSuperadmin(user.role)) return {};
  return { OR: [{ company: await companyScope(user) }, { transaction: await transactionScope(user) }] };
}

export async function assertDocument(user: AppUser, id: unknown) {
  if (typeof id !== "string" || id.trim() === "") throw new AccessError(404, "documento não encontrado");
  const doc = await prisma.document.findFirst({ where: { AND: [{ id }, await documentScope(user)] } });
  if (!doc) throw new AccessError(404, "documento não encontrado");
  return doc;
}

// ── dono e validação de entrada ──────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Exatamente um dono: companyId OU transactionId. */
export function parseOwner(body: Record<string, unknown>): DocumentOwner {
  const companyId = str(body.companyId);
  const transactionId = str(body.transactionId);
  if (!!companyId === !!transactionId) throw new RequestError(400, "informe a empresa OU a transação do documento");
  return companyId ? { companyId } : { transactionId: transactionId! };
}

async function assertOwner(user: AppUser, owner: DocumentOwner) {
  if ("companyId" in owner) await assertCompany(user, owner.companyId);
  else await assertTransaction(user, owner.transactionId);
}

const ownerPrefix = (owner: DocumentOwner) => ("companyId" in owner ? `co/${owner.companyId}` : `tx/${owner.transactionId}`);

function optionalDay(v: unknown, campo: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DAY_RE.test(v) || Number.isNaN(asDate(v).getTime()) || dayOf(asDate(v)) !== v) {
    throw new RequestError(400, `${campo}: data inválida (use AAAA-MM-DD)`);
  }
  return asDate(v);
}

function optionalTitle(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new RequestError(400, "título inválido");
  const t = v.trim();
  if (t.length > 200) throw new RequestError(400, "título: no máximo 200 caracteres");
  return t || null;
}

async function requireType(v: unknown): Promise<string> {
  const typeId = str(v);
  if (!typeId) throw new RequestError(400, "escolha o tipo do documento");
  const found = await prisma.documentType.findUnique({ where: { id: typeId }, select: { id: true } });
  if (!found) throw new RequestError(400, "tipo de documento não existe");
  return typeId;
}

function checkDates(issuedAt: Date | null, expiresAt: Date | null) {
  if (issuedAt && expiresAt && expiresAt < issuedAt) throw new RequestError(400, "o vencimento não pode ser antes da emissão");
}

const COMPANY_ONLY = ["typeId", "title", "issuedAt", "expiresAt", "replacesId"] as const;

function storageError(e: unknown): never {
  if (e instanceof StorageUnavailable) throw new RequestError(503, e.message);
  throw e;
}

function isUniqueViolation(e: unknown, campo: string): boolean {
  const err = e as { code?: string; meta?: unknown; message?: string };
  if (err?.code !== "P2002") return false;
  return JSON.stringify(err.meta ?? "").includes(campo) || String(err.message ?? "").includes(campo);
}

// ── upload em 2 passos ───────────────────────────────────────────────────────

/** Passo 1: confere dono, tipo e tamanho; devolve a chave e a URL assinada pro navegador subir. */
export async function startUpload(user: AppUser, body: Record<string, unknown>) {
  const owner = parseOwner(body);
  await assertOwner(user, owner);
  const filename = str(body.filename);
  const contentType = str(body.contentType);
  const size = Number(body.size);
  if (!filename) throw new RequestError(400, "nome do arquivo ausente");
  if (!contentType || !ALLOWED_TYPES.includes(contentType)) throw new RequestError(415, "tipo de arquivo não permitido (PDF, imagem, CSV ou XLSX)");
  if (!Number.isFinite(size) || size <= 0) throw new RequestError(400, "tamanho do arquivo inválido");
  if (size > MAX_UPLOAD_BYTES) throw new RequestError(413, `arquivo muito grande (máx. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  const key = buildKey(ownerPrefix(owner), filename);
  const uploadUrl = await presignUpload(key, contentType).catch(storageError);
  return { key, uploadUrl, contentType };
}

/** Passo 2: o arquivo chegou ao R2? Então registra o documento (anexo ou documento da empresa). */
export async function createDocument(user: AppUser, body: Record<string, unknown>) {
  const owner = parseOwner(body);
  await assertOwner(user, owner);

  const key = str(body.key);
  if (!key || !key.startsWith(`${ownerPrefix(owner)}/`) || key.includes("..")) {
    throw new RequestError(400, "chave do arquivo não corresponde ao dono informado");
  }
  const filename = str(body.filename)?.slice(0, 200) ?? "arquivo";

  let data: Prisma.DocumentUncheckedCreateInput;
  if ("companyId" in owner) {
    const typeId = await requireType(body.typeId);
    const issuedAt = optionalDay(body.issuedAt, "emissão");
    const expiresAt = optionalDay(body.expiresAt, "vencimento");
    checkDates(issuedAt, expiresAt);
    let replacesId: string | null = null;
    if (body.replacesId !== undefined && body.replacesId !== null && body.replacesId !== "") {
      const old = await assertDocument(user, body.replacesId);
      if (old.companyId !== owner.companyId) throw new RequestError(400, "só dá pra renovar um documento da mesma empresa");
      replacesId = old.id;
    }
    data = { companyId: owner.companyId, typeId, title: optionalTitle(body.title), issuedAt, expiresAt, replacesId, filename, path: `${R2_PREFIX}${key}` };
  } else {
    const extras = COMPANY_ONLY.filter((c) => body[c] !== undefined && body[c] !== null && body[c] !== "");
    if (extras.length) throw new RequestError(400, `anexo de transação não tem ${extras.join(", ")}`);
    data = { transactionId: owner.transactionId, filename, path: `${R2_PREFIX}${key}` };
  }

  const head = await headObject(key).catch(storageError);
  if (!head) throw new RequestError(400, "o arquivo não chegou ao armazenamento; envie de novo");
  if (head.size > MAX_UPLOAD_BYTES || !head.contentType || !ALLOWED_TYPES.includes(head.contentType)) {
    await deleteObject(key).catch(() => {});
    throw new RequestError(head.size > MAX_UPLOAD_BYTES ? 413 : 415, "arquivo recusado (tamanho ou tipo fora do permitido)");
  }

  try {
    return await prisma.document.create({
      data: { ...data, mimetype: head.contentType, size: head.size, uploadedById: user.id },
    });
  } catch (e) {
    if (isUniqueViolation(e, "replacesId")) throw new RequestError(409, "esse documento já foi renovado; renove a versão atual");
    if (isUniqueViolation(e, "path")) throw new RequestError(409, "esse arquivo já foi registrado");
    throw e;
  }
}

// ── leitura, edição e exclusão ───────────────────────────────────────────────

const LIST_INCLUDE = {
  company: { select: { id: true, name: true, color: true } },
  type: { select: { id: true, name: true } },
  uploadedBy: { select: { name: true, email: true } },
  replacedBy: { select: { id: true } },
} satisfies Prisma.DocumentInclude;

/** Documentos da empresa (não os anexos de transação), com o status calculado. */
export async function listCompanyDocuments(user: AppUser, q: URLSearchParams) {
  const [hoje, warnDays] = [today(), await getExpiryWarningDays()];
  const and: Prisma.DocumentWhereInput[] = [await documentScope(user), { companyId: { not: null } }];
  const companyId = str(q.get("companyId"));
  const typeId = str(q.get("typeId"));
  const status = str(q.get("status"));
  const busca = str(q.get("q"));
  if (companyId) and.push({ companyId });
  if (typeId) and.push({ typeId });
  if (status) {
    if (!(STATUS_FILTERS as readonly string[]).includes(status)) throw new RequestError(400, "status inválido");
    and.push(statusWhere(status as StatusFilter, hoje, warnDays));
  } else if (q.get("historico") !== "1") {
    and.push({ replacedBy: { is: null } });
  }
  if (busca) and.push({ OR: [{ title: { contains: busca, mode: "insensitive" } }, { filename: { contains: busca, mode: "insensitive" } }] });

  const docs = await prisma.document.findMany({
    where: { AND: and },
    include: LIST_INCLUDE,
    orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { uploadedAt: "desc" }],
  });
  return {
    today: hoje,
    warnDays,
    documents: docs.map(({ path: _path, ...d }) => ({
      ...d,
      issuedAt: d.issuedAt ? dayOf(d.issuedAt) : null,
      expiresAt: d.expiresAt ? dayOf(d.expiresAt) : null,
      status: documentStatus(d, hoje, warnDays),
    })),
  };
}

/** Edita os dados de um documento da empresa (o arquivo não muda; pra trocar o arquivo, renove). */
export async function updateCompanyDocument(user: AppUser, id: string, body: Record<string, unknown>) {
  const doc = await assertDocument(user, id);
  if (!doc.companyId) throw new RequestError(400, "anexo de transação não tem tipo nem validade");
  const data: Prisma.DocumentUncheckedUpdateInput = {};
  if (body.typeId !== undefined) data.typeId = await requireType(body.typeId);
  if (body.title !== undefined) data.title = optionalTitle(body.title);
  const issuedAt = body.issuedAt !== undefined ? optionalDay(body.issuedAt, "emissão") : doc.issuedAt;
  const expiresAt = body.expiresAt !== undefined ? optionalDay(body.expiresAt, "vencimento") : doc.expiresAt;
  checkDates(issuedAt, expiresAt);
  if (body.issuedAt !== undefined) data.issuedAt = issuedAt;
  if (body.expiresAt !== undefined) data.expiresAt = expiresAt;
  return prisma.document.update({ where: { id: doc.id }, data });
}

/** Apaga o arquivo no R2 e depois o registro. Sem armazenamento, não apaga nada (503). */
export async function deleteDocument(user: AppUser, id: string) {
  const doc = await assertDocument(user, id);
  if (doc.path.startsWith(R2_PREFIX)) await deleteObject(doc.path.slice(R2_PREFIX.length)).catch(storageError);
  await prisma.document.delete({ where: { id: doc.id } });
}

/** Corpo JSON de objeto (senão 400). */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "corpo JSON inválido");
  return body as Record<string, unknown>;
}

/** O que sai pra tela: nunca o caminho interno do arquivo. */
export function publicDoc<T extends { path: string }>(doc: T): Omit<T, "path"> {
  const { path: _path, ...rest } = doc;
  return rest;
}

// ── tipos de documento (lista editável) ──────────────────────────────────────

/** Nome do tipo: texto de 1 a 80 caracteres. */
export function typeName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name || name.length > 80) throw new RequestError(400, "nome do tipo: de 1 a 80 caracteres");
  return name;
}

export function isDuplicate(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}
