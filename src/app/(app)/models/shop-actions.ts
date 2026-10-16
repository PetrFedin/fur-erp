"use server";

import { rawPrisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { discardStaged, loadShopEditor, saveShop, type ShopEditorData, type ShopSaveResult } from "@/lib/article-shop";

/**
 * Окно «Магазин и фото». Все три действия — только владелец, администратор и технолог (ACCESS.models):
 * подрядчик (SUPPLIER) отклоняется в requireRole, поэтому PLU и ссылки магазина к нему не попадают ни при каком запросе.
 */
export async function loadArticleShop(modelId: string): Promise<{ data?: ShopEditorData; error?: string }> {
  const session = await requireRole(...ACCESS.models);
  const data = await loadShopEditor(rawPrisma, session.user.organizationId, String(modelId));
  return data ? { data } : { error: "Артикул не найден" };
}

export async function saveArticleShop(modelId: string, payload: unknown): Promise<ShopSaveResult> {
  const session = await requireRole(...ACCESS.models);
  const u = session.user;
  const r = await saveShop(rawPrisma, { id: u.id, name: u.name ?? null, role: u.role, organizationId: u.organizationId }, String(modelId), payload);
  if (r.ok && r.changed) revalidateAll(u.organizationId);
  return r;
}

export async function discardArticlePhotos(modelId: string, ids: string[]): Promise<void> {
  const session = await requireRole(...ACCESS.models);
  await discardStaged(rawPrisma, session.user.organizationId, String(modelId), ids);
}
