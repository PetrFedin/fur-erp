import "server-only";
// Удаление фото артикула: запись SystemState `article-photos:<id>` (или её часть) + файлы (оригинал и миниатюра) на диске + строка в журнале изменений.
// Вызывается только из server action (src/app/(app)/models/photo-actions.ts), роль и организация проверяются там и здесь.
import path from "node:path";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PHOTOS_KEY, readPhotos, type ArticlePhoto } from "./article-photos";
import { removeStoredFiles, resolveInside } from "./fitting-files";
import { rmdir } from "node:fs/promises";

export type DeletePhotoActor = { id: string; name: string | null; role: string; organizationId: string };
export type DeletePhotoResult = { ok: true; removed: number; left: number } | { ok: false; error: string };

/** Файл фото обязан лежать в каталоге этого артикула этой организации — иначе его не трогаем. */
const insideArticleDir = (rel: string, orgId: string, modelId: string) =>
  rel.startsWith(["article-photos", orgId, modelId].join("/") + "/") && !rel.includes("..") && resolveInside(rel) !== null;

/**
 * Удалить одно фото (photoId) или все фото артикула (photoId = null).
 * Чужое не удаляется: артикул ищется по организации актора, фото — только в записи этого артикула.
 * `db` — НЕ журналирующий клиент (rawPrisma): журнал пишем одной понятной строкой сами, в той же транзакции.
 */
export async function deleteArticlePhotos(db: PrismaClient, actor: DeletePhotoActor, modelId: string, photoId: string | null): Promise<DeletePhotoResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(modelId)) return { ok: false, error: "Артикул не найден" };
  if (photoId !== null && !/^[0-9a-f-]{8,40}$/i.test(photoId)) return { ok: false, error: "Фото не найдено" };
  const model = await db.productModel.findFirst({ where: { id: modelId, organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!model) return { ok: false, error: "Артикул не найден" };
  const key = PHOTOS_KEY + modelId;
  const row = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key } }, select: { value: true } });
  const all: ArticlePhoto[] = readPhotos(row?.value);
  const gone = photoId === null ? all : all.filter((p) => p.id === photoId);
  if (!gone.length) return { ok: false, error: photoId === null ? "У артикула нет фото" : "Фото не найдено (возможно, уже удалено)" };
  const left = all.filter((p) => !gone.includes(p));
  const label = photoId === null
    ? `Удалены все фото артикула ${model.name} (${gone.length})`
    : `Удалено фото артикула ${model.name}${gone[0].variant ? " · " + gone[0].variant : ""} (№ ${all.indexOf(gone[0]) + 1} из ${all.length})`;
  await db.$transaction(async (tx) => {
    if (left.length) await tx.systemState.update({ where: { organizationId_key: { organizationId: actor.organizationId, key } }, data: { value: { photos: left } as unknown as Prisma.InputJsonValue } });
    else await tx.systemState.delete({ where: { organizationId_key: { organizationId: actor.organizationId, key } } });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId, actorId: actor.id, actorName: actor.name, actorRole: actor.role, source: "ui",
        model: "ArticlePhoto", recordId: modelId, action: "delete", label,
        changes: { article: model.name, removed: gone.map((p) => ({ id: p.id, variant: p.variant, file: p.file })), left: left.length } as unknown as Prisma.InputJsonValue,
      },
    });
  });
  // Файлы — после записи в базе: сбой здесь оставит лишний файл на диске, но не «битую» ссылку.
  const files = gone.flatMap((p) => [p.file, p.thumb]).filter((f) => insideArticleDir(f, actor.organizationId, modelId));
  await removeStoredFiles(files);
  if (!left.length) {
    const dir = resolveInside(path.join("article-photos", actor.organizationId, modelId));
    if (dir) await rmdir(dir).catch(() => {}); // каталог убираем, только если опустел
  }
  return { ok: true, removed: gone.length, left: left.length };
}
