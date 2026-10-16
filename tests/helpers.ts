import { prisma } from "@/lib/db";
import { signSession, SESSION_COOKIE } from "@/lib/auth";

type FakeRequestState = { cookies: Record<string, string>; headers: Record<string, string> };
const g = globalThis as unknown as { __fakeRequest: FakeRequestState };

/** "Entra" como o usuário (cookie de sessão assinado, como o login antigo). null = deslogado. */
export function loginAs(user: { id: string; role: string } | null) {
  g.__fakeRequest.cookies = user ? { [SESSION_COOKIE]: signSession(user.id, user.role) } : {};
}

/** Cabeçalhos que o "navegador" manda (ex.: o JWT da Cloudflare). */
export function setRequestHeaders(h: Record<string, string>) {
  g.__fakeRequest.headers = h;
}

export function resetRequest() {
  g.__fakeRequest.cookies = {};
  g.__fakeRequest.headers = {};
}

/** Apaga tudo (ordem respeita as chaves estrangeiras). */
export async function wipe() {
  await prisma.document.deleteMany();
  await prisma.accountingSplit.deleteMany();
  await prisma.transactionSplit.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.company.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.operationMembership.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.operation.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Dois grupos que NÃO podem se ver:
 *  - Pixel: holding, empresa, conta, transação; usuário `pixel` (membro da holding)
 *  - Outro: holding, empresa, conta, transação; usuário `outro` (membro da holding)
 *  - `operador`: sem holding, só membro de uma operação ligada à conta da Pixel
 *  - `semAcesso`: logado, sem vínculo nenhum
 *  - `root`: superadmin
 */
export async function seedTwoGroups() {
  await wipe();
  const mk = (email: string, role = "member") =>
    prisma.user.create({ data: { email, role, passwordHash: "x:y", name: email.split("@")[0] } });
  const [root, pixel, outro, operador, semAcesso] = await Promise.all([
    mk("root@teste.com", "superadmin"),
    mk("pixel@teste.com"),
    mk("outro@teste.com"),
    mk("operador@teste.com"),
    mk("sem@teste.com"),
  ]);

  const hPixel = await prisma.holding.create({ data: { name: "Pixel" } });
  const hOutro = await prisma.holding.create({ data: { name: "Outro grupo" } });
  const opPixel = await prisma.operation.create({ data: { name: "Op Pixel", holdingId: hPixel.id } });

  const cPixel = await prisma.company.create({ data: { name: "Pixel Ads LLC", holdingId: hPixel.id } });
  const cOutro = await prisma.company.create({ data: { name: "Outra Empresa LTDA", holdingId: hOutro.id } });

  const aPixel = await prisma.account.create({
    data: { companyId: cPixel.id, bank: "Mercury", currency: "USD", name: "Mercury Pixel", operationId: opPixel.id },
  });
  const aOutro = await prisma.account.create({
    data: { companyId: cOutro.id, bank: "Wise", currency: "USD", name: "Wise Outro" },
  });

  const tPixel = await prisma.transaction.create({
    data: { accountId: aPixel.id, date: new Date("2026-10-01"), description: "Pagamento Pixel", amount: -100, currency: "USD", reference: "px-1" },
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
