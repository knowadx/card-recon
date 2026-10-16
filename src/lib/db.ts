import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  // Postgres (padrão do Hash): DATABASE_URL = postgresql://usuario:senha@host:5432/banco
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurado");
  return new PrismaClient({ adapter: new PrismaPg(url) } as never);
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
