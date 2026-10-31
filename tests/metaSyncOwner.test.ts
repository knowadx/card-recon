import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

// sem rede: o Meta "vê" a conta act_1 no perfil da Pixel; cobranças não importam aqui
vi.mock("@/lib/meta", () => ({
  fetchControlledAccounts: vi.fn(async () => ({
    accounts: [{ account_id: "act_1", name: "Nome novo", currency: "USD", account_status: 1, business: { id: "bm1", name: "BM" } }],
    bmAvailable: true,
    emptyBusinesses: [],
  })),
  parseFundingDisplay: () => ({ brand: null, last4: null }),
}));
vi.mock("@/lib/metaCharges", () => ({
  syncBillingCharges: vi.fn(async () => ({ charges: 0, accountsOk: 0, accountsTotal: 0, failed: [] })),
}));

const { POST } = await import("@/app/api/meta/sync/route");

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let opOutro: { id: string };
beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  await prisma.metaAdAccount.deleteMany();
  opOutro = await prisma.operation.create({ data: { name: "Op Outro" } });
  await prisma.metaAdAccount.create({ data: { accountId: "act_1", name: "Nome antigo", operationId: opOutro.id, company: "Op Outro" } });
  await prisma.credential.create({ data: { issuer: "meta", company: "Op Pixel", operationId: s.operations.pixel.id, token: "tok-meta-pixel", isActive: true } });
});

const run = () => POST(req("/api/meta/sync", { method: "POST", json: {} }));

describe("sync da Meta não 'puxa pra si' conta de anúncios de outro grupo", () => {
  it("membro da Op Pixel atualiza o nome, mas o dono continua sendo o outro grupo", async () => {
    loginAs(s.users.operador); // o Meta da operação é de quem OPERA (membro), não da holding
    expect((await run()).status).toBe(200);
    const row = await prisma.metaAdAccount.findUnique({ where: { accountId: "act_1" } });
    expect(row?.name).toBe("Nome novo");
    expect(row?.operationId).toBe(opOutro.id);
    expect(row?.company).toBe("Op Outro");
  });

  it("superadmin pode reatribuir", async () => {
    loginAs(s.users.root);
    expect((await run()).status).toBe(200);
    expect((await prisma.metaAdAccount.findUnique({ where: { accountId: "act_1" } }))?.operationId).toBe(s.operations.pixel.id);
  });
});
