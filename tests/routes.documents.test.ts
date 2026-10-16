import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as documentRoute from "@/app/api/documents/[id]/route";
import { loginAs, params, req, resetRequest, seedTwoGroups } from "./helpers";

const R2 = { R2_ACCOUNT_ID: "conta123", R2_BUCKET: "pixelfinance-arquivos", R2_ACCESS_KEY_ID: "AKID", R2_SECRET_ACCESS_KEY: "SECRET" };

let s: Awaited<ReturnType<typeof seedTwoGroups>>;
let docR2: { id: string };
let docLegacy: { id: string };

beforeEach(async () => {
  resetRequest();
  s = await seedTwoGroups();
  docR2 = await prisma.document.create({
    data: { transactionId: s.transactions.pixel.id, filename: "fatura.pdf", path: "r2:tx/x/2026/10/u-fatura.pdf", mimetype: "application/pdf" },
  });
  docLegacy = await prisma.document.create({
    data: { transactionId: s.transactions.pixel.id, filename: "antigo.pdf", path: "/uploads/x/antigo.pdf" },
  });
});
afterEach(() => vi.unstubAllEnvs());

const open = (id: string) => documentRoute.GET(req(`/api/documents/${id}`), params({ id }));

describe("GET /api/documents/[id]", () => {
  it("dono do grupo é redirecionado para o R2 (link curto e assinado)", async () => {
    Object.entries(R2).forEach(([k, v]) => vi.stubEnv(k, v));
    loginAs(s.users.pixel);
    const res = await open(docR2.id);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("conta123.r2.cloudflarestorage.com");
    expect(loc.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("outro grupo recebe 404 (nem confirma que o anexo existe); deslogado 401", async () => {
    Object.entries(R2).forEach(([k, v]) => vi.stubEnv(k, v));
    loginAs(s.users.outro);
    expect((await open(docR2.id)).status).toBe(404);
    loginAs(null);
    expect((await open(docR2.id)).status).toBe(401);
  });

  it("anexo antigo (disco do servidor) = 410; armazenamento desligado = 503", async () => {
    loginAs(s.users.pixel);
    expect((await open(docLegacy.id)).status).toBe(410);
    expect((await open(docR2.id)).status).toBe(503);
  });
});
