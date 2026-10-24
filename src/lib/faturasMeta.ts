import { prisma } from "@/lib/db";
import { isSuperadmin } from "@/lib/auth";
import { transactionScope, type AppUser } from "@/lib/access";
import { MAX_UPLOAD_BYTES, headObject } from "@/lib/storage";

/**
 * PDF da fatura da Meta no Cloudflare R2 (pedido do dono em 2026-10-24). Nome FIXO pelo id da transação
 * da Meta: reimportar a mesma fatura só sobrescreve o mesmo arquivo (nada duplica).
 */
const ID_META = /^[0-9]+-[0-9]+$/; // "Identificação da transação" do recibo (ex.: 123456789-987654321)

export const idMetaValido = (id: string) => ID_META.test(id);
export const chaveFaturaMeta = (transactionId: string) => `faturas-meta/${transactionId}.pdf`;

/**
 * Confere no R2 quais PDFs chegaram de fato (o navegador DIZ que subiu; quem confirma é o R2).
 * Devolve id → tamanho. Sem R2 configurado ou falha na consulta = não guarda o vínculo (o dado da
 * fatura entra igual).
 */
export async function pdfsQueChegaram(ids: string[]): Promise<Map<string, number>> {
  const ok = new Map<string, number>();
  const fila = ids.filter(idMetaValido);
  const LOTE = 10;
  for (let i = 0; i < fila.length; i += LOTE) {
    await Promise.all(fila.slice(i, i + LOTE).map(async (id) => {
      try {
        const head = await headObject(chaveFaturaMeta(id));
        if (head && head.size > 0 && head.size <= MAX_UPLOAD_BYTES && head.contentType === "application/pdf") ok.set(id, head.size);
      } catch { /* R2 fora / sem config: sem vínculo de arquivo pra esta */ }
    }));
  }
  return ok;
}

/**
 * Quem abre o PDF de uma fatura: superadmin, ou quem enxerga alguma cobrança da Meta com o MESMO
 * código (a fatura não é de uma empresa só — o escopo vem da cobrança, como no Fechamento).
 */
export async function podeVerFatura(user: AppUser, referenceNumber: string | null): Promise<boolean> {
  if (isSuperadmin(user.role)) return true;
  if (!referenceNumber) return false;
  const achou = await prisma.transaction.findFirst({
    where: { AND: [{ isMetaCharge: true, metaRef: { equals: referenceNumber, mode: "insensitive" } }, await transactionScope(user)] },
    select: { id: true },
  });
  return !!achou;
}
