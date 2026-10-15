"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession } from "@/lib/supplier-inbox";
import { parseDateInput } from "@/lib/input";
import { AUCTION_ACTION, AUCTION_PLAN_FLAG, AUCTION_STATUS } from "@/lib/auction-calendar";
import { invalidateControlCounts } from "@/lib/control-counts";

export type AuctionState = { error?: string; ok?: boolean };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Добавить дату аукциона (без id) или исправить свою отметку (с id). Видна у нас в «Календаре», слой «Аукционы». */
export async function saveAuction(_prev: AuctionState, fd: FormData): Promise<AuctionState> {
  const s = await requireSupplierSession();
  const id = clip(fd.get("id"), 64);
  const name = clip(fd.get("name"), 100);
  const house = clip(fd.get("house"), 100);
  const place = clip(fd.get("place"), 100);
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 1000);
  const date = parseDateInput(clip(fd.get("date"), 10));
  if (!name) return { error: "Укажите название аукциона, например «СП 09-26»" };
  if (!date) return { error: "Укажите дату аукциона" };
  const data = { date, articleCode: name, articleName: house || null, color: place || null, notes: notes || null, docNote: fd.get("participate") === "on" ? AUCTION_PLAN_FLAG : null };
  if (id) {
    if (!ID.test(id)) return { error: "Отметка не найдена" };
    const u = await prisma.calendarEvent.updateMany({ where: { id, organizationId: s.user.organizationId, supplierId: s.user.supplierId, action: AUCTION_ACTION }, data });
    if (u.count !== 1) return { error: "Отметка не найдена или принадлежит не вам" };
  } else {
    await prisma.calendarEvent.create({ data: { ...data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id, action: AUCTION_ACTION, status: AUCTION_STATUS, quantity: 0 } });
  }
  invalidateControlCounts(s.user.organizationId);
  revalidatePath("/supplier/calendar");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteAuction(id: string): Promise<AuctionState> {
  const s = await requireSupplierSession();
  if (!ID.test(id)) return { error: "Отметка не найдена" };
  const r = await prisma.calendarEvent.deleteMany({ where: { id, organizationId: s.user.organizationId, supplierId: s.user.supplierId, action: AUCTION_ACTION } });
  if (r.count !== 1) return { error: "Отметка уже удалена" };
  revalidatePath("/supplier/calendar");
  revalidatePath("/calendar");
  return { ok: true };
}
