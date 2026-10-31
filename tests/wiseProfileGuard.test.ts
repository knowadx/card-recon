import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as wiseRoute from "@/app/api/sync/wise/route";
import { companyKey } from "@/lib/sync/wise";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";
import { WISE_PROFILE, installFakeBanks, seedBankAccounts, wiseFixture } from "./bankFakes";

/**
 * A mesma chave Wise enxerga perfis de várias empresas (inclusive da AV). Antes de importar, o sync
 * confere o DONO do perfil e que ele não está em outra conta (o sync traz o perfil inteiro).
 */
let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let acc: Awaited<ReturnType<typeof seedBankAccounts>>;

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  acc = await seedBankAccounts(s);
  loginAs(s.users.pixel);
});
afterEach(() => vi.unstubAllGlobals());

const sync = () => wiseRoute.POST(req("/api/sync/wise", { method: "POST", json: { accountId: acc.wise.id, profileId: WISE_PROFILE, from: "2026-10-01" } }));
const importadas = () => prisma.transaction.count({ where: { accountId: acc.wise.id } });

describe("sync Wise confere o dono do perfil", () => {
  it("perfil de OUTRA empresa (ex.: da AV) = 400, nada importado e o perfil não fica salvo", async () => {
    const antes = await importadas();
    installFakeBanks({ wise: { [WISE_PROFILE]: { ...wiseFixture(), profileName: "ActiveView OÜ" } } });
    const res = await sync();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não é da empresa "Pixel Ads LLC"/);
    expect(await importadas()).toBe(antes);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.wise.id } })).syncConfig).toBeNull();
    expect(await prisma.importCoverage.count({ where: { accountId: acc.wise.id } })).toBe(0); // recusado não conta como importado
  });

  it("perfil já ligado a OUTRA conta = 400 (duplicaria as transações)", async () => {
    await prisma.account.create({
      data: { companyId: s.companies.pixel.id, bank: "Wise", currency: "EUR", name: "Wise Pixel antiga", apiToken: "tok-x", syncConfig: JSON.stringify({ wiseProfileId: WISE_PROFILE }) },
    });
    installFakeBanks({ wise: { [WISE_PROFILE]: wiseFixture() } });
    const res = await sync();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/já é sincronizado na conta "Wise Pixel antiga"/);
  });

  it("mesmo nome com caixa/sufixo diferente passa (PIXEL ADS = Pixel Ads LLC)", async () => {
    installFakeBanks({ wise: { [WISE_PROFILE]: { ...wiseFixture(), profileName: "PIXEL ADS" } } });
    const antes = Date.now();
    expect((await sync()).status).toBe(200);
    // sync que TERMINA grava a cobertura até agora (libera o Fechamento Meta do mês)
    const cob = await prisma.importCoverage.findFirstOrThrow({ where: { accountId: acc.wise.id } });
    expect(cob.source).toBe("api");
    expect(cob.to.getTime() >= antes - 1000).toBe(true);
    expect(JSON.parse((await prisma.account.findUniqueOrThrow({ where: { id: acc.wise.id } })).syncConfig!)).toEqual({ wiseProfileId: WISE_PROFILE });
  });

  it("chave de comparação ignora acento, caixa e sufixo societário", () => {
    expect(companyKey("PubViews OÜ")).toBe(companyKey("PubViews"));
    expect(companyKey("LinkView OÜ")).toBe(companyKey("LinkView"));
    expect(companyKey("Najiba Serviços Digitais LTDA")).toBe("najibaservicosdigitais");
    expect(companyKey("ActiveView OÜ")).not.toBe(companyKey("LinkView OÜ"));
  });
});
