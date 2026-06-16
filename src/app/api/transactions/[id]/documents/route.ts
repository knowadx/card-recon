import { prisma } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Validate id to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return Response.json({ error: "Invalid transaction id" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "no file" }, { status: 400 });

  if (file.size > MAX_SIZE) return Response.json({ error: "Arquivo muito grande (máx 10 MB)" }, { status: 413 });
  if (!ALLOWED_TYPES.includes(file.type)) return Response.json({ error: "Tipo de arquivo não permitido" }, { status: 415 });

  const safeFilename = sanitizeFilename(file.name);
  const uploadDir = path.join(process.cwd(), "uploads", id);
  await mkdir(uploadDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${Date.now()}-${safeFilename}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  try {
    const doc = await prisma.document.create({
      data: { transactionId: id, filename: file.name, path: `/uploads/${id}/${filename}`, mimetype: file.type || null, size: file.size },
    });
    return Response.json(doc, { status: 201 });
  } catch {
    return Response.json({ error: "Erro ao salvar documento" }, { status: 500 });
  }
}
