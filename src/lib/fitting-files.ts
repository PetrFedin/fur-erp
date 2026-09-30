import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile, readFile, rmdir } from "node:fs/promises";
import path from "node:path";

/**
 * Хранилище фото примерок: файлы на диске в UPLOAD_DIR, в БД (FittingPhoto)
 * лежит только путь относительно UPLOAD_DIR. Имя файла на диске — uuid,
 * исходное имя хранится лишь в БД, поэтому путь не зависит от того, что
 * прислал пользователь. Читаем/удаляем только пути из БД, и только если они
 * после path.resolve остаются внутри UPLOAD_DIR.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 10;

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");

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
  const files = entries.filter((e): e is File => typeof e !== "string" && e.size > 0);
  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    return { error: `За один раз можно загрузить не больше ${MAX_PHOTOS_PER_UPLOAD} фото (выбрано ${files.length})` };
  }
  const out: { buf: Buffer; kind: ImageKind; originalName: string }[] = [];
  for (const f of files) {
    const name = f.name || "файл";
    if (f.size > MAX_PHOTO_BYTES) {
      return { error: `Файл «${name}» больше 10 МБ (${(f.size / 1024 / 1024).toFixed(1)} МБ)` };
    }
    const declared = (f.type || "").toLowerCase();
    const heicByName = /\.(heic|heif)$/i.test(name);
    if (!DECLARED_OK.has(declared) && !(declared === "" && heicByName)) {
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

/** Путь внутри UPLOAD_ROOT или null, если он оттуда выходит. */
export function resolveInside(storagePath: string): string | null {
  if (!storagePath || storagePath.includes("\0")) return null;
  const abs = path.resolve(UPLOAD_ROOT, storagePath);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

/** Пишет файлы на диск; при сбое убирает уже записанные и пробрасывает ошибку. */
export async function writePhotoFiles(
  organizationId: string,
  fittingId: string,
  files: { buf: Buffer; kind: ImageKind; originalName: string }[],
): Promise<StoredPhoto[]> {
  const dirRel = path.join("fittings", organizationId, fittingId);
  const dirAbs = resolveInside(dirRel);
  if (!dirAbs) throw new Error("Некорректный каталог загрузок");
  await mkdir(dirAbs, { recursive: true });
  const written: StoredPhoto[] = [];
  try {
    for (const f of files) {
      const rel = path.join(dirRel, `${randomUUID()}.${f.kind.ext}`);
      const abs = resolveInside(rel);
      if (!abs) throw new Error("Некорректный путь файла");
      await writeFile(abs, f.buf, { flag: "wx" });
      written.push({ storagePath: rel, originalName: f.originalName, mimeType: f.kind.mime, sizeBytes: f.buf.length });
    }
  } catch (e) {
    await removeStoredFiles(written.map((w) => w.storagePath));
    throw e;
  }
  return written;
}

/** Удаляет только файлы внутри UPLOAD_ROOT; отсутствующий файл — не ошибка. */
export async function removeStoredFiles(storagePaths: string[]) {
  for (const p of storagePaths) {
    const abs = resolveInside(p);
    if (!abs) continue;
    try {
      await unlink(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("Не удалось удалить файл фото", p, e);
    }
  }
}

export async function readStoredFile(storagePath: string): Promise<Buffer | null> {
  const abs = resolveInside(storagePath);
  if (!abs) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

/** Убирает каталог примерки, если он опустел (rmdir не трогает непустой каталог). */
export async function removeFittingDirIfEmpty(organizationId: string, fittingId: string) {
  const abs = resolveInside(path.join("fittings", organizationId, fittingId));
  if (!abs) return;
  try {
    await rmdir(abs);
  } catch {
    // каталога нет или в нём остались файлы — оставляем как есть
  }
}
