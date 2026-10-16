"use server";

import { rawPrisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { deleteArticlePhotos } from "@/lib/article-photo-delete";

export type PhotoDeleteState = { error?: string; left?: number };

/** Только владелец и роли заказчика с правом править артикул (ACCESS.models); подрядчик (SUPPLIER) отклоняется в requireRole. */
async function run(u: { id: string; name?: string | null; role: string; organizationId: string }, modelId: string, photoId: string | null): Promise<PhotoDeleteState> {
  const r = await deleteArticlePhotos(rawPrisma, { id: u.id, name: u.name ?? null, role: u.role, organizationId: u.organizationId }, String(modelId), photoId === null ? null : String(photoId));
  if (!r.ok) return { error: r.error };
  revalidateAll(u.organizationId);
  return { left: r.left };
}

export async function deleteArticlePhoto(modelId: string, photoId: string): Promise<PhotoDeleteState> {
  const session = await requireRole(...ACCESS.models);
  return run(session.user, modelId, String(photoId));
}

export async function deleteAllArticlePhotos(modelId: string): Promise<PhotoDeleteState> {
  const session = await requireRole(...ACCESS.models);
  return run(session.user, modelId, null);
}
