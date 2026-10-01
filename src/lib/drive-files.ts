import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveInside, removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, type ReadDoc } from "@/lib/purchase-files";

/**
 * Оригиналы документов Drive, загруженные в приложение: UPLOAD_DIR/drive-docs/<организация>/<uuid>.<ext>.
 * В БД (DriveDocument.storagePath) — путь относительно UPLOAD_DIR; исходное имя — storedName.
 * Тип — по сигнатуре содержимого (PDF, XLSX, DOCX, JPEG, PNG), размер до 25 МБ.
 */

export type StoredDriveFile = { storagePath: string; storedName: string; storedMime: string; storedSize: number };

/** Читает и проверяет один файл из формы (поле fieldName). */
export async function readOneDriveFile(
  formData: FormData,
  fieldName = "file",
): Promise<{ error: string } | { file: ReadDoc }> {
  const entries = formData.getAll(fieldName);
  if (entries.filter((e) => typeof e !== "string" && e.size > 0).length > 1) return { error: "Выберите один файл" };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return { error: read.error };
  return { file: read.files[0] };
}

export async function writeDriveFile(organizationId: string, f: ReadDoc): Promise<StoredDriveFile> {
  const dirRel = path.join("drive-docs", organizationId);
  const dirAbs = resolveInside(dirRel);
  if (!dirAbs) throw new Error("Некорректный каталог загрузок");
  await mkdir(dirAbs, { recursive: true });
  const rel = path.join(dirRel, `${randomUUID()}.${f.kind.ext}`);
  const abs = resolveInside(rel);
  if (!abs) throw new Error("Некорректный путь файла");
  await writeFile(abs, f.buf, { flag: "wx" });
  return { storagePath: rel, storedName: f.originalName, storedMime: f.kind.mime, storedSize: f.buf.length };
}

/** Удаляет файл с диска, только если на этот путь больше не ссылается ни документ Drive, ни документ закупки. */
export async function removeDriveFileIfUnused(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  const [a, b] = await Promise.all([
    prisma.driveDocument.count({ where: { storagePath } }),
    prisma.purchaseDocument.count({ where: { storagePath } }),
  ]);
  if (a + b === 0) await removeStoredFiles([storagePath]);
}
