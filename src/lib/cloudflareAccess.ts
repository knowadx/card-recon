import { prisma } from "@/lib/db";

/**
 * Lista de acesso da Cloudflare = usuários ATIVOS do sistema (pedido do dono em 2026-10-16: "tem que
 * colocar um User novo na cloudflare toda vez que eu criar um novo no sistema?").
 *
 * Fonte única: a tabela User. Tudo que muda quem entra (criar, ativar/desativar, apagar usuário) chama
 * `sincronizarAcessoCloudflare()`, que reescreve só as regras de E-MAIL da política "Equipe PixelFinance";
 * regras de outro tipo (grupo, domínio...) e os demais campos da política ficam como estão.
 *
 * O app continua sendo quem decide (getCurrentUser exige usuário ativo): se a Cloudflare falhar, quem foi
 * desativado segue barrado no app, e quem foi criado só não entra até a próxima sincronização.
 */
export type ResultadoAcesso =
  | { status: "desligado" } // sem configuração no .env: nada foi feito
  | { status: "em_dia"; emails: string[] }
  | { status: "divergente"; incluir: string[]; remover: string[] } // só na conferência (aplicar: false)
  | { status: "atualizado"; incluidos: string[]; removidos: string[] }
  | { status: "erro"; erro: string };

const API = "https://api.cloudflare.com/client/v4";

// campos da política que voltam no PUT como estavam (o PUT substitui a política inteira)
const CAMPOS_MANTIDOS = [
  "name", "decision", "exclude", "require", "session_duration", "approval_required", "approval_groups",
  "isolation_required", "purpose_justification_required", "purpose_justification_prompt",
] as const;

type Regra = { email?: { email?: string } } & Record<string, unknown>;
type RespostaCf = { success?: boolean; errors?: Array<{ message?: string }>; result?: Record<string, unknown> };

function config() {
  const token = process.env.CF_ACCESS_API_TOKEN;
  const conta = process.env.CF_ACCOUNT_ID;
  const politica = process.env.CF_ACCESS_POLICY_ID;
  return token && conta && politica ? { token, conta, politica } : null;
}

const emailDaRegra = (r: Regra) => (typeof r?.email?.email === "string" ? r.email.email.trim().toLowerCase() : null);
const erroCf = (d: RespostaCf | null) => d?.errors?.map((e) => e.message).filter(Boolean).join("; ") || "resposta inesperada";

/** Confere (aplicar: false) ou acerta (padrão) a lista de e-mails da política com os usuários ativos. */
export async function sincronizarAcessoCloudflare({ aplicar = true }: { aplicar?: boolean } = {}): Promise<ResultadoAcesso> {
  const cfg = config();
  if (!cfg) return { status: "desligado" };

  const ativos = await prisma.user.findMany({ where: { isActive: true }, select: { email: true } });
  const desejados = [...new Set(ativos.map((u) => u.email.trim().toLowerCase()))].sort();
  // lista vazia trancaria todo mundo do lado de fora (inclusive quem conserta) — nunca grava isso
  if (!desejados.length) return { status: "erro", erro: "nenhum usuário ativo — a lista da Cloudflare não foi esvaziada" };

  const url = `${API}/accounts/${cfg.conta}/access/policies/${cfg.politica}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, "content-type": "application/json" };
  try {
    const lida = (await (await fetch(url, { headers })).json().catch(() => null)) as RespostaCf | null;
    if (!lida?.success || !lida.result) return { status: "erro", erro: `Cloudflare (ler a política): ${erroCf(lida)}` };
    const politica = lida.result;
    const regras = (Array.isArray(politica.include) ? politica.include : []) as Regra[];
    const atuais = [...new Set(regras.map(emailDaRegra).filter((e): e is string => !!e))].sort();

    const incluir = desejados.filter((e) => !atuais.includes(e));
    const remover = atuais.filter((e) => !desejados.includes(e));
    if (!incluir.length && !remover.length) return { status: "em_dia", emails: desejados };
    if (!aplicar) return { status: "divergente", incluir, remover };

    const corpo: Record<string, unknown> = {};
    for (const campo of CAMPOS_MANTIDOS) if (politica[campo] !== undefined && politica[campo] !== null) corpo[campo] = politica[campo];
    corpo.include = [...regras.filter((r) => !emailDaRegra(r)), ...desejados.map((email) => ({ email: { email } }))];

    const gravada = (await (await fetch(url, { method: "PUT", headers, body: JSON.stringify(corpo) })).json().catch(() => null)) as RespostaCf | null;
    if (!gravada?.success) return { status: "erro", erro: `Cloudflare (gravar a política): ${erroCf(gravada)}` };
    return { status: "atualizado", incluidos: incluir, removidos: remover };
  } catch (e) {
    return { status: "erro", erro: `Cloudflare fora do ar: ${(e as Error).message}` };
  }
}
