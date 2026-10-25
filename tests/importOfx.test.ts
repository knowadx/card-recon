import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as importOfx from "@/app/api/import/ofx/route";
import { dataOfx, lerOfx } from "@/lib/ofx";
import * as syncBtg from "@/app/api/sync/btg/route";
import { loginAs, req, resetRequest, seedTwoGroups } from "./helpers";

/**
 * Importação de extrato OFX (pedido do dono em 2026-10-24, começando pela XP Empresas — sem API pro
 * cliente). OFX sintético no MESMO formato do arquivo real da XP (SGML 102 com fechamento, data AAAAMMDD,
 * FITID UUID, cabeçalho CHARSET:1252) — nenhum dado real aqui.
 */
const ofxXp = (acct = "1234567", lancs = [
  ["DEBIT", "20261022", "-115.00", "11111111-aaaa-4bbb-8ccc-000000000001", "Pix enviado para Fornecedor Exemplo Ltda"],
  ["DEBIT", "20261021", "-1130.00", "11111111-aaaa-4bbb-8ccc-000000000002", "Pagamento para FACEBK *ABCD1234XY"],
  ["CREDIT", "20261002", "5000.00", "11111111-aaaa-4bbb-8ccc-000000000003", "Pix recebido de Cliente Exemplo"],
], moeda = "BRL") => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>${moeda}</CURDEF>
        <BANKACCTFROM>
          <BANKID>348</BANKID>
          <BRANCHID>0001</BRANCHID>
          <ACCTID>${acct}</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260924</DTSTART>
          <DTEND>20261024</DTEND>
${lancs.map(([t, d, v, id, memo]) => `          <STMTTRN>
            <TRNTYPE>${t}</TRNTYPE>
            <DTPOSTED>${d}</DTPOSTED>
            <TRNAMT>${v}</TRNAMT>
            <FITID>${id}</FITID>
            <CHECKNUM>348</CHECKNUM>
            <MEMO>${memo}</MEMO>
          </STMTTRN>`).join("\n")}
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>1365.06</BALAMT>
          <DTASOF>20261024</DTASOF>
        </LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let admin: { id: string; email: string };
let contaXp: { id: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  admin = await prisma.user.create({ data: { email: "adm-px@teste.com", role: "admin", name: "Admin Pixel" } });
  await prisma.membership.create({ data: { userId: admin.id, holdingId: s.holdings.pixel.id } });
  contaXp = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "XP", currency: "BRL", name: "XP Pixel", operationId: s.operations.pixel.id } });
});

const importar = (accountId: string, ofx: string) =>
  importOfx.POST(new Request(`http://localhost/api/import/ofx?accountId=${accountId}`, { method: "POST", headers: { "content-type": "application/x-ofx", "x-filename": encodeURIComponent("extrato_xp.ofx") }, body: ofx }));
const linhas = () => prisma.transaction.findMany({ where: { accountId: contaXp.id }, orderBy: { date: "asc" } });

describe("leitura do OFX", () => {
  it("formato da XP: conta, moeda, período, saldo e lançamentos (data sem hora = meio-dia UTC)", () => {
    const { extrato } = lerOfx(ofxXp());
    expect(extrato).toMatchObject({ banco: "348", agencia: "0001", conta: "1234567", moeda: "BRL", saldo: 1365.06 });
    expect(extrato!.lancamentos.map((l) => [l.fitid.slice(-1), l.valor, l.data.toISOString(), l.tipo])).toEqual([
      ["1", -115, "2026-10-22T12:00:00.000Z", "DEBIT"],
      ["2", -1130, "2026-10-21T12:00:00.000Z", "DEBIT"],
      ["3", 5000, "2026-10-02T12:00:00.000Z", "CREDIT"],
    ]);
  });

  it("SGML sem fechamento das folhas nem do STMTTRN, com hora e fuso (variante de outros bancos)", () => {
    const sgml = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>99887</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005143000[-3:BRT]<TRNAMT>-10,50<FITID>A1<NAME>LOJA X<MEMO>COMPRA CARTAO
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>20.00<FITID>A2<MEMO>DEPOSITO
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { extrato } = lerOfx(sgml);
    expect(extrato!.conta).toBe("99887");
    expect(extrato!.lancamentos.map((l) => [l.fitid, l.valor, l.data.toISOString(), l.descricao])).toEqual([
      ["A1", -10.5, "2026-10-05T17:30:00.000Z", "LOJA X — COMPRA CARTAO"],
      ["A2", 20, "2026-10-06T12:00:00.000Z", "DEPOSITO"],
    ]);
    expect(dataOfx("20261005")?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });

  it("formato do BTG: folhas sem fechamento, data com hora e fuso [-3:BRT], FITID numérico, sem agência", () => {
    const btg = "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nCHARSET:1252\n\n<OFX>\n\t<BANKMSGSRSV1>\n\t\t<STMTTRNRS>\n\t\t\t<STMTRS>\n\t\t\t\t<CURDEF>BRL\n" +
      "\t\t\t\t<BANKACCTFROM>\n\t\t\t\t\t<BANKID>208\n\t\t\t\t\t<ACCTID>123456789\n\t\t\t\t\t<ACCTTYPE>CHECKING\n\t\t\t\t</BANKACCTFROM>\n" +
      "\t\t\t\t<BANKTRANLIST>\n\t\t\t\t\t<DTSTART>20261001000000[-3:BRT]\n\t\t\t\t\t<DTEND>20261025235959[-3:BRT]\n" +
      "\t\t\t\t\t<STMTTRN>\n\t\t\t\t\t\t<TRNTYPE>DEBIT\n\t\t\t\t\t\t<DTPOSTED>20261001062134[-3:BRT]\n\t\t\t\t\t\t<TRNAMT>-1500.00\n\t\t\t\t\t\t<FITID>1234567890123456789012345678901\n\t\t\t\t\t\t<CHECKNUM>1\n\t\t\t\t\t\t<MEMO>Pagamento de boleto\n\t\t\t\t\t</STMTTRN>\n" +
      "\t\t\t\t\t<STMTTRN>\n\t\t\t\t\t\t<TRNTYPE>CREDIT\n\t\t\t\t\t\t<DTPOSTED>20261025052446[-3:BRT]\n\t\t\t\t\t\t<TRNAMT>2.50\n\t\t\t\t\t\t<FITID>1234567890123456789012345678902\n\t\t\t\t\t\t<CHECKNUM>2\n\t\t\t\t\t\t<MEMO>Rendimento\n\t\t\t\t\t</STMTTRN>\n" +
      "\t\t\t\t</BANKTRANLIST>\n\t\t\t\t<LEDGERBAL>\n\t\t\t\t\t<BALAMT>1871.19\n\t\t\t\t\t<DTASOF>20261025235959[-3:BRT]\n\t\t\t\t</LEDGERBAL>\n\t\t\t</STMTRS>\n\t\t</STMTTRNRS>\n\t</BANKMSGSRSV1>\n</OFX>\n";
    const { extrato } = lerOfx(btg);
    expect(extrato).toMatchObject({ banco: "208", agencia: null, conta: "123456789", moeda: "BRL", saldo: 1871.19 });
    expect(extrato!.inicio!.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(extrato!.lancamentos.map((l) => [l.fitid.slice(-1), l.valor, l.data.toISOString(), l.descricao])).toEqual([
      ["1", -1500, "2026-10-01T09:21:34.000Z", "Pagamento de boleto"],
      ["2", 2.5, "2026-10-25T08:24:46.000Z", "Rendimento"],
    ]);
  });

  it("recusa o que não é OFX ou não diz a conta", () => {
    expect(lerOfx("Data;Hora;Descricao;Valor;Saldo").erro).toBe("isso não é um arquivo OFX");
    expect(lerOfx("<OFX><STMTTRN><FITID>1</OFX>").erro).toBe("o OFX não diz de qual conta é (sem ACCTID)");
  });
});

describe("POST /api/import/ofx", () => {
  it("grava os lançamentos na conta XP: sinal, data, operação e cobrança Meta marcada pela regra de sempre", async () => {
    loginAs(admin);
    const r = await (await importar(contaXp.id, ofxXp())).json();
    expect(r).toMatchObject({ ok: true, lancamentos: 3, gravados: 3, jaExistiam: 0, contaBanco: "348/0001/1234567", saldo: 1365.06 });
    const l = await linhas();
    expect(l.map((t) => [t.reference, t.amount, t.currency])).toEqual([
      ["ofx:348:1234567:11111111-aaaa-4bbb-8ccc-000000000003", 5000, "BRL"],
      ["ofx:348:1234567:11111111-aaaa-4bbb-8ccc-000000000002", -1130, "BRL"],
      ["ofx:348:1234567:11111111-aaaa-4bbb-8ccc-000000000001", -115, "BRL"],
    ]);
    expect(l[1]).toMatchObject({ description: "Pagamento para FACEBK *ABCD1234XY", isMetaCharge: true, metaRef: "ABCD1234XY", operationId: s.operations.pixel.id });
    const log = await prisma.importLog.findFirstOrThrow({ where: { kind: "ofx" } });
    expect(log).toMatchObject({ filename: "extrato_xp.ofx", userId: admin.id, companyIds: [s.companies.pixel.id] });
  });

  it("reimportar o mesmo extrato (ou um período que se sobrepõe) não duplica — o FITID manda", async () => {
    loginAs(admin);
    await importar(contaXp.id, ofxXp());
    expect(await (await importar(contaXp.id, ofxXp())).json()).toMatchObject({ gravados: 0, jaExistiam: 3 });
    expect(await linhas()).toHaveLength(3);
  });

  it("trava: OFX de OUTRA conta bancária depois do primeiro import = 400 e nada gravado", async () => {
    loginAs(admin);
    await importar(contaXp.id, ofxXp("1234567"));
    const res = await importar(contaXp.id, ofxXp("7654321", [["DEBIT", "20261023", "-1.00", "zz-1", "outra conta"]]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("conta errada?");
    expect(await linhas()).toHaveLength(3);
  });

  it("trava: moeda diferente da conta = 400; conta que sincroniza por API = 400", async () => {
    loginAs(admin);
    expect((await importar(contaXp.id, ofxXp("1234567", undefined, "USD"))).status).toBe(400);
    await prisma.account.update({ where: { id: s.accounts.pixel.id }, data: { syncConfig: JSON.stringify({ mercuryAccountId: "m1" }) } });
    const mercury = await importar(s.accounts.pixel.id, ofxXp()); // Mercury Pixel configurada pra API → duplicaria
    expect(mercury.status).toBe(400);
    expect((await mercury.json()).error).toContain("duplicaria");
  });

  it("BTG: conta ainda sem API aceita OFX; depois de receber OFX, o sync pela API do BTG é recusado (duplicaria)", async () => {
    const contaBtg = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "BTG", currency: "BRL", name: "BTG Pixel" } });
    loginAs(admin);
    expect(await (await importar(contaBtg.id, ofxXp("998877"))).json()).toMatchObject({ ok: true, gravados: 3 });
    const sync = await syncBtg.POST(req("/api/sync/btg", { method: "POST", json: { accountId: contaBtg.id } }));
    expect(sync.status).toBe(409);
    expect((await sync.json()).error).toContain("já recebe extratos por OFX");
  });

  it("BTG: conta já configurada pra API recusa OFX", async () => {
    const contaBtg = await prisma.account.create({ data: { companyId: s.companies.pixel.id, bank: "BTG", currency: "BRL", name: "BTG Pixel", syncConfig: JSON.stringify({ btgAccountId: "x" }) } });
    loginAs(admin);
    const res = await importar(contaBtg.id, ofxXp());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("já sincroniza pela API do BTG");
  });

  it("membro = 403; conta de outro grupo = 404 (nada gravado)", async () => {
    loginAs(s.users.pixel);
    expect((await importar(contaXp.id, ofxXp())).status).toBe(403);
    loginAs(s.users.root);
    const contaOutro = await prisma.account.create({ data: { companyId: s.companies.outro.id, bank: "XP", currency: "BRL", name: "XP Outro" } });
    loginAs(admin);
    expect((await importar(contaOutro.id, ofxXp())).status).toBe(404);
    expect(await prisma.transaction.count({ where: { accountId: contaOutro.id } })).toBe(0);
  });
});
