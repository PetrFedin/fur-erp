"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { isFittingStatus, parseFittingDate } from "@/lib/fittings";
import { removeStoredFiles, removeFittingDirIfEmpty } from "@/lib/fitting-files";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type FittingFormState = { error?: string; ok?: boolean };

export async function updateFitting(id: string, _prev: FittingFormState, formData: FormData): Promise<FittingFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const fitting = await prisma.fitting.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, productionOrderId: true },
  });
  if (!fitting) return { error: "Примерка не найдена" };
  const str = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string).trim() : "");
  const date = parseFittingDate(str("date"));
  if (!date) return { error: "Укажите дату примерки" };
  const status = str("status");
  if (!isFittingStatus(status)) return { error: "Выберите итог примерки" };
  await prisma.fitting.update({
    where: { id },
    data: {
      fittingDate: date,
      status,
      size: str("size").slice(0, 100) || null,
      comment: str("comment").slice(0, 5000) || null,
    },
  });
  revalidatePath("/fittings");
  revalidatePath(`/fittings/${id}`);
  revalidatePath(`/production/${fitting.productionOrderId}`);
  return { ok: true };
}

export async function deleteFittingPhoto(photoId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const photo = await prisma.fittingPhoto.findFirst({
    where: { id: photoId, fitting: { organizationId: session.user.organizationId } },
    include: { fitting: { select: { id: true, productionOrderId: true } } },
  });
  if (!photo) return;
  await prisma.fittingPhoto.delete({ where: { id: photoId } });
  await removeStoredFiles([photo.storagePath]);
  revalidatePath("/fittings");
  revalidatePath(`/fittings/${photo.fitting.id}`);
  revalidatePath(`/production/${photo.fitting.productionOrderId}`);
}

export async function deleteFitting(id: string) {
  const session = await requireRole(...EDIT_ROLES);
  const fitting = await prisma.fitting.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { photos: { select: { storagePath: true } } },
  });
  if (!fitting) redirect("/fittings");
  await prisma.fitting.delete({ where: { id } }); // фото в БД удаляются каскадом
  await removeStoredFiles(fitting.photos.map((p) => p.storagePath));
  await removeFittingDirIfEmpty(fitting.organizationId, fitting.id);
  revalidatePath("/fittings");
  revalidatePath(`/production/${fitting.productionOrderId}`);
  redirect("/fittings");
}
