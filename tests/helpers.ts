import { prisma } from "@/lib/db";
import { ACCESS_JWT_HEADER } from "@/lib/accessJwt";
import { signTestJwt } from "./accessTestKeys";

type FakeRequestState = { headers: Record<string, string> };
const g = globalThis as unknown as { __fakeRequest: FakeRequestState };

/**
 * "Entra" como o usuário pelo login da Cloudflare (o ÚNICO do app): põe no pedido um JWT da
 * Cloudflare com o e-mail dele. `claims` extras só servem pra provar que o JWT não muda o papel
 * (o papel vem do banco). null = deslogado.
 */
export function loginAs(user: { email: string } | null, claims: Record<string, unknown> = {}) {
  const { [ACCESS_JWT_HEADER]: _antigo, ...resto } = g.__fakeRequest.headers;
  g.__fakeRequest.headers = user ? { ...resto, [ACCESS_JWT_HEADER]: signTestJwt({ email: user.email, ...claims }) } : resto;
}

/** Cabeçalhos que o "navegador" manda (troca todos — inclusive o JWT do loginAs). */
export function setRequestHeaders(h: Record<string, string>) {
  g.__fakeRequest.headers = h;
}

export function resetRequest() {
  g.__fakeRequest.headers = {};
}

/** Apaga tudo: TRUNCATE de todas as tabelas do banco de TESTE (nunca a de migrations). */
export async function wipe() {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

/**
 * Dois grupos que NÃO podem se ver:
 *  - Pixel: holding, empresa, conta, transação; usuário `pixel` (membro da holding)
 *  - Outro: holding, empresa, conta, transação; usuário `outro` (membro da holding)
 *  - `operador`: sem holding, só membro da operação `Op Pixel`, marcada no SPLIT da transação da Pixel
 *    (a operação mora só no split: dá a transação, não a conta nem a empresa)
 *  - `semAcesso`: logado, sem vínculo nenhum
 *  - `root`: superadmin
 */
export async function seedTwoGroups() {
  await wipe();
  const mk = (email: string, role = "member") =>
    prisma.user.create({ data: { email, role, name: email.split("@")[0] } });
  const [root, pixel, outro, operador, semAcesso] = await Promise.all([
    mk("root@teste.com", "superadmin"),
    mk("pixel@teste.com"),
    mk("outro@teste.com"),
    mk("operador@teste.com"),
    mk("sem@teste.com"),
  ]);

  const hPixel = await prisma.holding.create({ data: { name: "Pixel" } });
  const hOutro = await prisma.holding.create({ data: { name: "Outro grupo" } });
  const opPixel = await prisma.operation.create({ data: { name: "Op Pixel" } });

  const cPixel = await prisma.company.create({ data: { name: "Pixel Ads LLC", holdingId: hPixel.id } });
  const cOutro = await prisma.company.create({ data: { name: "Outra Empresa LTDA", holdingId: hOutro.id } });

  const aPixel = await prisma.account.create({
    data: { companyId: cPixel.id, bank: "Mercury", currency: "USD", name: "Mercury Pixel" },
  });
  const aOutro = await prisma.account.create({
    data: { companyId: cOutro.id, bank: "Wise", currency: "USD", name: "Wise Outro" },
  });

  const tPixel = await prisma.transaction.create({
    data: {
      accountId: aPixel.id, date: new Date("2026-10-01"), description: "Pagamento Pixel", amount: -100, currency: "USD", reference: "px-1",
      splits: { create: { amount: -100, operationId: opPixel.id } },
    },
  });
  const tOutro = await prisma.transaction.create({
    data: { accountId: aOutro.id, date: new Date("2026-10-01"), description: "Pagamento Outro", amount: -200, currency: "USD", reference: "ot-1" },
  });

  await prisma.membership.create({ data: { userId: pixel.id, holdingId: hPixel.id } });
  await prisma.membership.create({ data: { userId: outro.id, holdingId: hOutro.id } });
  await prisma.operationMembership.create({ data: { userId: operador.id, operationId: opPixel.id } });

  return {
    users: { root, pixel, outro, operador, semAcesso },
    holdings: { pixel: hPixel, outro: hOutro },
    operations: { pixel: opPixel },
    companies: { pixel: cPixel, outro: cOutro },
    accounts: { pixel: aPixel, outro: aOutro },
    transactions: { pixel: tPixel, outro: tOutro },
  };
}

/** Monta um Request para chamar o handler da rota direto. */
export function req(path: string, init?: RequestInit & { json?: unknown }) {
  const { json, ...rest } = init ?? {};
  return new Request(`http://localhost${path}`, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
