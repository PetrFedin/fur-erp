import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { UPLOAD_ROOT, resolveInside, putStoredFile, getStoredFile, deleteStoredFiles, removeStoredDirIfEmpty } from "@/lib/storage";

// Путь и проверка пути — в хранилище (src/lib/storage.ts); здесь прежние имена для импортов.
export { UPLOAD_ROOT, resolveInside };

/**
 * Хранилище фото примерок: файлы в хранилище (папка UPLOAD_DIR или S3, src/lib/storage.ts), в БД (FittingPhoto)
 * лежит только путь относительно UPLOAD_DIR. Имя файла на диске — uuid,
 * исходное имя хранится лишь в БД, поэтому путь не зависит от того, что
 * прислал пользователь. Читаем/удаляем только пути из БД, и только если они
 * после path.resolve остаются внутри UPLOAD_DIR.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 10;
export const MAX_TOTAL_UPLOAD_BYTES = 50 * 1024 * 1024;


type ImageKind = { mime: string; ext: string };

const JPEG: ImageKind = { mime: "image/jpeg", ext: "jpg" };
const PNG: ImageKind = { mime: "image/png", ext: "png" };
const WEBP: ImageKind = { mime: "image/webp", ext: "webp" };
const HEIC: ImageKind = { mime: "image/heic", ext: "heic" };

/** Тип картинки по сигнатуре начала файла (а не по имени и не по заявленному mime). */
export function detectImage(head: Buffer): ImageKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return JPEG;
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return PNG;
  if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return WEBP;
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp") {
    const brand = head.toString("latin1", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"].includes(brand)) return HEIC;
  }
  return null;
}

const DECLARED_OK = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export type StoredPhoto = { storagePath: string; originalName: string; mimeType: string; sizeBytes: number };

/** Проверяет и читает файлы из формы. Возвращает понятную ошибку по-русски либо готовые буферы. */
export async function readPhotoFiles(
  entries: FormDataEntryValue[],
): Promise<{ error: string } | { files: { buf: Buffer; kind: ImageKind; originalName: string }[] }> {
  const files = entries.filter((e): e is File => typeof e !== "string");
  const empty = files.find((f) => f.size === 0);
  if (empty) return { error: `Файл «${empty.name || "файл"}» пустой (0 байт) — выберите фото заново` };
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    return { error: `Общий размер фото больше 50 МБ (${(totalBytes / 1024 / 1024).toFixed(2)} МБ) — загрузите часть файлов отдельно` };
  }
  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    return { error: `За один раз можно загрузить не больше ${MAX_PHOTOS_PER_UPLOAD} фото (выбрано ${files.length})` };
  }
  const out: { buf: Buffer; kind: ImageKind; originalName: string }[] = [];
  for (const f of files) {
    const name = f.name || "файл";
    if (f.size > MAX_PHOTO_BYTES) {
      return { error: `Файл «${name}» больше 10 МБ (${(f.size / 1024 / 1024).toFixed(2)} МБ)` };
    }
    const declared = (f.type || "").toLowerCase();
    const heicByName = /\.(heic|heif)$/i.test(name);
    // Chrome вне macOS отдаёт HEIC с пустым типом, а fetch — как octet-stream: решает сигнатура содержимого ниже.
    const typeless = declared === "" || declared === "application/octet-stream";
    if (!DECLARED_OK.has(declared) && !(typeless && heicByName)) {
      return { error: `Файл «${name}» не является фото: допустимы JPEG, PNG, WebP, HEIC` };
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = detectImage(buf.subarray(0, 16));
    if (!kind) {
      return { error: `Файл «${name}» не является фото: содержимое не похоже на JPEG, PNG, WebP или HEIC` };
    }
    out.push({ buf, kind, originalName: name.slice(0, 200) });
  }
  return { files: out };
}

/** Пишет файлы в хранилище; при сбое убирает уже записанные и пробрасывает ошибку. */
export async function writePhotoFiles(
  organizationId: string,
  fittingId: string,
  files: { buf: Buffer; kind: ImageKind; originalName: string }[],
): Promise<StoredPhoto[]> {
  const dirRel = path.join("fittings", organizationId, fittingId);
  if (!resolveInside(dirRel)) throw new Error("Некорректный каталог загрузок");
  const written: StoredPhoto[] = [];
  try {
    for (const f of files) {
      const rel = path.join(dirRel, `${randomUUID()}.${f.kind.ext}`);
      if (!resolveInside(rel)) throw new Error("Некорректный путь файла");
      await putStoredFile(rel, f.buf, { contentType: f.kind.mime, exclusive: true });
      written.push({ storagePath: rel, originalName: f.originalName, mimeType: f.kind.mime, sizeBytes: f.buf.length });
    }
  } catch (e) {
    await removeStoredFiles(written.map((w) => w.storagePath));
    throw e;
  }
  return written;
}

/** Удаляет только файлы внутри хранилища; отсутствующий файл — не ошибка. */
export async function removeStoredFiles(storagePaths: string[]) {
  await deleteStoredFiles(storagePaths);
}

export async function readStoredFile(storagePath: string): Promise<Buffer | null> {
  return getStoredFile(storagePath);
}

/** Убирает каталог примерки, если он опустел (в S3 каталогов нет — ничего не делает). */
export async function removeFittingDirIfEmpty(organizationId: string, fittingId: string) {
  await removeStoredDirIfEmpty(path.join("fittings", organizationId, fittingId));
}
