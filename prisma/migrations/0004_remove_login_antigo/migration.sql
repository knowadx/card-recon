-- Login SÓ pela Cloudflare (decisão do dono em 2026-10-16): some o que era do login antigo por
-- cookie/senha — a senha (hash) dos usuários e a tabela de sessões (vazia: a migração da Turso já
-- pulava as sessões). Gerado com `prisma migrate diff`.

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash";

-- DropTable
DROP TABLE "Session";

