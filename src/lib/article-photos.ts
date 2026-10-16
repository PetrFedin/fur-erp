import "server-only";
// Фото артикулов и ссылки «Товар в магазине». Миграции не требуют: данные лежат в SystemState (как запасной путь свойств артикула),
// файлы — в UPLOAD_DIR/article-photos/<организация>/<артикул>/<uuid>.jpg (+ миниатюра <uuid>-t.jpg).
//   article-photos:<modelId>      -> { photos: [{ id, file, thumb, w, h, variant }] }  (порядок = порядок показа)
//   article-shop-links:<modelId>  -> { links: [{ variant, itemId, url }] }            (только для сотрудников заказчика)
// Ссылки магазина лежат в отдельном ключе, чтобы кабинет подрядчика их не читал вообще.
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { resolveInside } from "./fitting-files";
import { isSafeShopUrl } from "./article-shop-core";

export const PHOTOS_KEY = "article-photos:";
export const LINKS_KEY = "article-shop-links:";

/** color — цвет товара на странице магазина (запасное название); itemId — код страницы магазина, с которой взято фото (связь с ShopLink). */
export type ArticlePhoto = { id: string; file: string; thumb: string; w: number; h: number; variant: string; color?: string; itemId?: string };
export type ShopLink = { variant: string; itemId: string; url: string; color?: string };
type Db = Pick<PrismaClient, "systemState">;

export function readPhotos(value: unknown): ArticlePhoto[] {
  const raw = value && typeof value === "object" ? (value as { photos?: unknown }).photos : null;
  if (!Array.isArray(raw)) return [];
  const out: ArticlePhoto[] = [];
  for (const p of raw as Partial<ArticlePhoto>[]) {
    if (p && typeof p.id === "string" && /^[0-9a-f-]{8,40}$/i.test(p.id) && typeof p.file === "string" && typeof p.thumb === "string") {
      out.push({ id: p.id, file: p.file, thumb: p.thumb, w: Number(p.w) || 0, h: Number(p.h) || 0, variant: typeof p.variant === "string" ? p.variant : "",
        ...(typeof p.color === "string" && p.color ? { color: p.color.slice(0, 60) } : {}), ...(typeof p.itemId === "string" && /^[\w-]{3,40}$/.test(p.itemId) ? { itemId: p.itemId } : {}) });
    }
  }
  return out;
}

export function readLinks(value: unknown): ShopLink[] {
  const raw = value && typeof value === "object" ? (value as { links?: unknown }).links : null;
  if (!Array.isArray(raw)) return [];
  const out: ShopLink[] = [];
  for (const l of raw as Partial<ShopLink>[]) {
    // Ссылка — любая http/https без логина и пароля (раньше только tsum.ru/product: теперь ссылки вносит и сам сотрудник).
    if (l && isSafeShopUrl(l.url)) {
      out.push({ variant: typeof l.variant === "string" ? l.variant : "", itemId: typeof l.itemId === "string" ? l.itemId : "", url: l.url, ...(typeof l.color === "string" && l.color ? { color: l.color.slice(0, 60) } : {}) });
    }
  }
  return out;
}

/** Фото артикула по порядку. */
export async function loadArticlePhotos(db: Db, orgId: string, modelId: string): Promise<ArticlePhoto[]> {
  const row = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PHOTOS_KEY + modelId } }, select: { value: true } });
  return readPhotos(row?.value);
}

/** Сводка для списка: id артикула -> фото (id и вариант) по порядку. Без ссылок магазина. */
export async function loadPhotoSummary(db: Db, orgId: string): Promise<Map<string, { id: string; variant: string; color?: string; itemId?: string }[]>> {
  const rows = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PHOTOS_KEY } }, select: { key: true, value: true } });
  const out = new Map<string, { id: string; variant: string; color?: string; itemId?: string }[]>();
  for (const r of rows) {
    const list = readPhotos(r.value);
    if (list.length) out.set(r.key.slice(PHOTOS_KEY.length), list.map((p) => ({ id: p.id, variant: p.variant, ...(p.color ? { color: p.color } : {}), ...(p.itemId ? { itemId: p.itemId } : {}) })));
  }
  return out;
}

/** Ссылки «Товар в магазине» — ТОЛЬКО для сотрудников заказчика (вызывающий проверяет роль). */
export async function loadShopLinks(db: Db, orgId: string, modelId: string): Promise<ShopLink[]> {
  const row = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: LINKS_KEY + modelId } }, select: { value: true } });
  return readLinks(row?.value);
}

export async function readPhotoFile(rel: string): Promise<Buffer | null> {
  const abs = resolveInside(rel);
  if (!abs || !rel.startsWith("article-photos" + path.sep) && !rel.startsWith("article-photos/")) return null;
  try { return await readFile(abs); } catch { return null; }
}

/** Все ссылки магазина организации: id артикула -> ссылки. ТОЛЬКО для сотрудников заказчика. */
export async function loadAllShopLinks(db: Db, orgId: string): Promise<Map<string, ShopLink[]>> {
  const rows = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: LINKS_KEY } }, select: { key: true, value: true } });
  const out = new Map<string, ShopLink[]>();
  for (const r of rows) { const l = readLinks(r.value); if (l.length) out.set(r.key.slice(LINKS_KEY.length), l); }
  return out;
}

