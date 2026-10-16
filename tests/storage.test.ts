import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StorageUnavailable,
  buildKey,
  headObject,
  presignDownload,
  presignUpload,
  safeFilename,
  storageConfig,
} from "@/lib/storage";

const R2 = { R2_ACCOUNT_ID: "conta123", R2_BUCKET: "pixelfinance-arquivos", R2_ACCESS_KEY_ID: "AKID", R2_SECRET_ACCESS_KEY: "SECRET" };
const on = () => Object.entries(R2).forEach(([k, v]) => vi.stubEnv(k, v));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("storageConfig", () => {
  it("só liga com as 4 variáveis", () => {
    expect(storageConfig({})).toBeNull();
    expect(storageConfig({ ...R2, R2_SECRET_ACCESS_KEY: "" })).toBeNull();
    expect(storageConfig(R2)).toEqual({ accountId: "conta123", bucket: "pixelfinance-arquivos", accessKeyId: "AKID", secretAccessKey: "SECRET" });
  });

  it("desligado: assinar URL falha com StorageUnavailable (nunca cai pro disco local)", async () => {
    await expect(presignUpload("tx/1/a.pdf", "application/pdf")).rejects.toBeInstanceOf(StorageUnavailable);
  });
});

describe("nomes e chaves", () => {
  it("tira pasta, acento e caractere perigoso; nunca vazio", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\x\\Fatura março.pdf")).toBe("Fatura marco.pdf");
    expect(safeFilename("a<b>|c?.pdf")).toBe("a_b_c_.pdf");
    expect(safeFilename("...")).toBe("arquivo");
    expect(safeFilename(undefined)).toBe("arquivo");
    expect(safeFilename("x".repeat(300) + ".pdf").length).toBe(120);
  });

  it("a chave começa no escopo do servidor e não deixa o nome escapar dele", () => {
    const key = buildKey("tx/abc", "../../outro/escopo.pdf", new Date("2026-10-15T12:00:00Z"), "uuid-1");
    expect(key).toBe("tx/abc/2026/10/uuid-1-escopo.pdf");
  });
});

describe("URLs assinadas", () => {
  it("upload: PUT assinado no bucket certo, com validade e Content-Type na assinatura", async () => {
    on();
    const url = new URL(await presignUpload("tx/abc/2026/10/u-fatura.pdf", "application/pdf"));
    expect(url.host).toBe("conta123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/pixelfinance-arquivos/tx/abc/2026/10/u-fatura.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.toString()).not.toContain("SECRET");
  });

  it("download: GET de 5 min, abre no navegador com o nome do arquivo", async () => {
    on();
    const url = new URL(await presignDownload("tx/abc/2026/10/u-fatura.pdf", "Fatura março.pdf"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe("inline; filename*=UTF-8''Fatura%20marco.pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("headObject: 404 = não existe; 200 = tamanho e tipo (sem rede: fetch simulado)", async () => {
    on();
    const fake = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("nao-existe")) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { "content-length": "1234", "content-type": "application/pdf" } });
    });
    vi.stubGlobal("fetch", fake);
    expect(await headObject("tx/abc/nao-existe.pdf")).toBeNull();
    expect(await headObject("tx/abc/existe.pdf")).toEqual({ size: 1234, contentType: "application/pdf" });
    expect(fake).toHaveBeenCalledTimes(2);
  });
});
