import "server-only";
// Загрузка фото артикула: проверка по содержимому (сигнатура), sharp (длинная сторона ≤1600 px, jpg + миниатюра ≤400 px),
// файлы <uuid>.jpg и <uuid>-t.jpg строго в каталоге article-photos/<организация>/<артикул>/.
// Загруженное файл ждёт «Сохранить»: в запись article-photos:<id> он попадает только при сохранении (article-shop.ts).
import { randomUUID } from "node:crypto";
import { listStoredFiles, putStoredFile } from "./storage";
import { detectImage, removeStoredFiles, resolveInside } from "./fitting-files";
import { PHOTO_MAX_BYTES, PHOTOS_PER_ARTICLE_MAX } from "./article-shop-core";
import { PHOTOS_KEY, readPhotos } from "./article-photos";
import type { PrismaClient } from "@prisma/client";

export type StagedPhoto = { id: string; w: number; h: number };
export type StageResult = { ok: true; photo: StagedPhoto } | { ok: false; error: string };

const ORPHAN_AGE_MS = 60 * 60 * 1000;
export const articleDirRel = (orgId: string, modelId: string) => ["article-photos", orgId, modelId].join("/");
export const photoRel = (orgId: string, modelId: string, id: string, thumb = false) => `${articleDirRel(orgId, modelId)}/${id}${thumb ? "-t" : ""}.jpg`;

/** Файл -> два jpg (оригинал ≤1600, миниатюра ≤400) либо понятная ошибка. Расширение и заявленный тип не учитываются. */
export async function processPhotoBuffer(buf: Buffer): Promise<{ ok: true; full: Buffer; thumb: Buffer; w: number; h: number } | { ok: false; error: string }> {
  if (buf.length === 0) return { ok: false, error: "Файл пустой" };
  if (buf.length > PHOTO_MAX_BYTES) return { ok: false, error: `Файл больше ${PHOTO_MAX_BYTES / 1024 / 1024} МБ` };
  const kind = detectImage(buf.subarray(0, 16));
  if (!kind) return { ok: false, error: "Это не фото: допустимы JPG, PNG, WebP, HEIC" };
  try {
    const sharp = (await import("sharp")).default;
    const base = () => sharp(buf, { limitInputPixels: 120_000_000, failOn: "error" }).rotate();
    const full = await base().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const thumb = await base().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
    return { ok: true, full: full.data, thumb, w: full.info.width, h: full.info.height };
  } catch {
    return { ok: false, error: kind.ext === "heic" ? "Формат HEIC не читается: пришлите JPG (iPhone: Настройки → Камера → Форматы → Наиболее совместимый)" : "Файл повреждён или не открывается как фото" };
  }
}

/** Удаляет файлы каталога артикула, которых нет в записи и которые лежат больше часа (брошенные загрузки). */
async function sweepOrphans(dirRel: string, keep: Set<string>) {
  const now = Date.now();
  for (const f of await listStoredFiles(dirRel)) {
    const id = /^([0-9a-f-]{36})(-t)?\.jpg$/i.exec(f.name)?.[1];
    if (!id || keep.has(id)) continue;
    if (now - f.mtimeMs > ORPHAN_AGE_MS) await removeStoredFiles([`${dirRel}/${f.name}`]);
  }
}

type Db = Pick<PrismaClient, "productModel" | "systemState">;

/** Принять один файл: проверить артикул организации и лимит, обработать и записать на диск. Запись в БД — только при «Сохранить». */
export async function stageArticlePhoto(db: Db, orgId: string, modelId: string, buf: Buffer): Promise<StageResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(modelId)) return { ok: false, error: "Артикул не найден" };
  const model = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { id: true } });
  if (!model) return { ok: false, error: "Артикул не найден" };
  const rec = readPhotos((await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PHOTOS_KEY + modelId } }, select: { value: true } }))?.value);
  const dirRel = articleDirRel(orgId, modelId);
  if (!resolveInside(dirRel)) return { ok: false, error: "Артикул не найден" };
  await sweepOrphans(dirRel, new Set(rec.map((p) => p.id)));
  const onDisk = (await listStoredFiles(dirRel)).filter((f) => /^[0-9a-f-]{36}\.jpg$/i.test(f.name)).length;
  if (onDisk >= PHOTOS_PER_ARTICLE_MAX) return { ok: false, error: `У артикула уже ${PHOTOS_PER_ARTICLE_MAX} фото — это максимум` };
  const r = await processPhotoBuffer(buf);
  if (!r.ok) return r;
  const id = randomUUID();
  const fAbs = resolveInside(photoRel(orgId, modelId, id)), tAbs = resolveInside(photoRel(orgId, modelId, id, true));
  if (!fAbs || !tAbs) return { ok: false, error: "Некорректный путь файла" };
  await putStoredFile(photoRel(orgId, modelId, id), r.full, { contentType: "image/jpeg", exclusive: true });
  await putStoredFile(photoRel(orgId, modelId, id, true), r.thumb, { contentType: "image/jpeg", exclusive: true });
  return { ok: true, photo: { id, w: r.w, h: r.h } };
}
