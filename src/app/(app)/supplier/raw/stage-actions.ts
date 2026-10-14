"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession } from "@/lib/supplier-inbox";
import { RAW_STAGE_KEYS, todayDay } from "@/lib/raw-stage";

export type StageState = { error?: string; ok?: boolean };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const STATUSES = ["PLANNED", "IN_PROGRESS", "DONE"];

function day(v: FormDataEntryValue | null): Date | null | "bad" {
  const t = clip(v, 10);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) return "bad";
  return new Date(`${t}T00:00:00Z`);
}
const today = () => new Date(todayDay());

function refresh(purchaseId: string) {
  revalidatePath(`/supplier/raw/${purchaseId}`);
  revalidatePath("/supplier/raw");
  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/purchases");
  revalidatePath("/lots");
  revalidatePath("/calendar");
}

/** Закупка — только этого поставщика и этой организации. */
async function ownPurchase(orgId: string, supplierId: string, purchaseId: string) {
  if (!ID.test(purchaseId)) return null;
  return prisma.purchase.findFirst({ where: { id: purchaseId, organizationId: orgId, supplierId, status: { not: "CANCELLED" } }, select: { id: true } });
}
/** Этап — только свой (организация + поставщик). */
async function ownStage(orgId: string, supplierId: string, id: string) {
  if (!ID.test(id)) return null;
  return prisma.supplierRawStage.findFirst({ where: { id, organizationId: orgId, supplierId } });
}

/** Добавить этап (на весь аукцион или на выбранные лоты) либо изменить существующий (id в форме). */
export async function saveStage(_prev: StageState, fd: FormData): Promise<StageState> {
  const s = await requireSupplierSession();
  const orgId = s.user.organizationId, supplierId = s.user.supplierId;
  const stage = clip(fd.get("stage"), 40);
  const status = clip(fd.get("status"), 20) || "PLANNED";
  if (!RAW_STAGE_KEYS.includes(stage)) return { error: "Выберите этап из списка" };
  if (!STATUSES.includes(status)) return { error: "Проверьте статус" };
  const dates = { plannedStart: day(fd.get("plannedStart")), plannedEnd: day(fd.get("plannedEnd")), factStart: day(fd.get("factStart")), factEnd: day(fd.get("factEnd")) };
  if (Object.values(dates).includes("bad")) return { error: "Дата — в формате ГГГГ-ММ-ДД" };
  const d = dates as Record<keyof typeof dates, Date | null>;
  if (d.plannedStart && d.plannedEnd && d.plannedEnd < d.plannedStart) return { error: "План: конец раньше начала" };
  if (d.factStart && d.factEnd && d.factEnd < d.factStart) return { error: "Факт: конец раньше начала" };
  const qtyRaw = clip(fd.get("qty"), 9);
  const qty = qtyRaw === "" ? null : Number(qtyRaw);
  if (qty != null && (!Number.isInteger(qty) || qty < 0)) return { error: "Количество — целое число шкур" };
  const data = { stage, status, place: clip(fd.get("place"), 80) || null, ...d, qty, note: clip(fd.get("note"), 500) || null };

  const id = clip(fd.get("id"), 64);
  if (id) {
    const cur = await ownStage(orgId, supplierId, id);
    if (!cur) return { error: "Этап не найден" };
    await prisma.supplierRawStage.update({ where: { id: cur.id }, data });
    refresh(cur.purchaseId);
    return { ok: true };
  }
  const purchaseId = clip(fd.get("purchaseId"), 64);
  const purchase = await ownPurchase(orgId, supplierId, purchaseId);
  if (!purchase) return { error: "Закупка не найдена" };
  // Лоты — номера из этой же закупки; пусто = весь аукцион.
  const wanted = fd.getAll("lots").map((x) => clip(x, 60)).filter(Boolean);
  const items = wanted.length ? await prisma.purchaseItem.findMany({ where: { purchaseId: purchase.id, lotNumber: { in: wanted } }, select: { lotNumber: true, lotId: true } }) : [];
  if (wanted.length && items.length === 0) return { error: "Лоты не найдены" };
  const scopes = wanted.length ? [...new Map(items.map((i) => [i.lotNumber, i])).values()] : [null];
  for (const it of scopes) {
    await prisma.supplierRawStage.create({
      data: { ...data, organizationId: orgId, supplierId, purchaseId: purchase.id, lotId: it?.lotId ?? null, lotNumber: it?.lotNumber ?? null, createdById: s.user.id },
    });
  }
  refresh(purchase.id);
  return { ok: true };
}

type R = { error?: string };

/** «Начать этап»: В работе, факт начала — сегодня. */
export async function startStage(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const cur = await ownStage(s.user.organizationId, s.user.supplierId, id);
  if (!cur) return { error: "Этап не найден" };
  await prisma.supplierRawStage.update({ where: { id: cur.id }, data: { status: "IN_PROGRESS", factStart: cur.factStart ?? today(), factEnd: null } });
  refresh(cur.purchaseId);
  return {};
}

/** «Завершить»: Готово, факт окончания — сегодня. */
export async function finishStage(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const cur = await ownStage(s.user.organizationId, s.user.supplierId, id);
  if (!cur) return { error: "Этап не найден" };
  await prisma.supplierRawStage.update({ where: { id: cur.id }, data: { status: "DONE", factStart: cur.factStart ?? today(), factEnd: today() } });
  refresh(cur.purchaseId);
  return {};
}

/** «→ следующий этап»: завершить этот и начать следующий по справочнику (есть в ленте — начать, нет — создать). */
export async function nextStage(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const orgId = s.user.organizationId, supplierId = s.user.supplierId;
  const cur = await ownStage(orgId, supplierId, id);
  if (!cur) return { error: "Этап не найден" };
  const nextKey = RAW_STAGE_KEYS[RAW_STAGE_KEYS.indexOf(cur.stage) + 1];
  await prisma.supplierRawStage.update({ where: { id: cur.id }, data: { status: "DONE", factStart: cur.factStart ?? today(), factEnd: today() } });
  if (nextKey) {
    const existing = await prisma.supplierRawStage.findFirst({
      where: { organizationId: orgId, supplierId, purchaseId: cur.purchaseId, stage: nextKey, lotNumber: cur.lotNumber, status: { not: "DONE" } },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      await prisma.supplierRawStage.update({ where: { id: existing.id }, data: { status: "IN_PROGRESS", factStart: existing.factStart ?? today(), factEnd: null } });
    } else {
      await prisma.supplierRawStage.create({
        data: { organizationId: orgId, supplierId, purchaseId: cur.purchaseId, lotId: cur.lotId, lotNumber: cur.lotNumber, stage: nextKey, status: "IN_PROGRESS", factStart: today(), qty: cur.qty, createdById: s.user.id },
      });
    }
  }
  refresh(cur.purchaseId);
  return {};
}

export async function deleteStage(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const cur = await ownStage(s.user.organizationId, s.user.supplierId, id);
  if (!cur) return { error: "Этап не найден" };
  await prisma.supplierRawStage.delete({ where: { id: cur.id } });
  refresh(cur.purchaseId);
  return {};
}

/** «Скопировать цепочку из прошлого аукциона»: этапы (без дат и статусов) последнего другого аукциона этого поставщика. Только в пустую ленту. */
export async function copyChain(purchaseId: string): Promise<R> {
  const s = await requireSupplierSession();
  const orgId = s.user.organizationId, supplierId = s.user.supplierId;
  const purchase = await ownPurchase(orgId, supplierId, purchaseId);
  if (!purchase) return { error: "Закупка не найдена" };
  if (await prisma.supplierRawStage.count({ where: { organizationId: orgId, supplierId, purchaseId: purchase.id } })) return { error: "Цепочка уже есть" };
  const last = await prisma.supplierRawStage.findFirst({ where: { organizationId: orgId, supplierId, purchaseId: { not: purchase.id }, lotNumber: null }, orderBy: { updatedAt: "desc" }, select: { purchaseId: true } });
  if (!last) return { error: "Прошлых аукционов с этапами нет" };
  const src = await prisma.supplierRawStage.findMany({ where: { organizationId: orgId, supplierId, purchaseId: last.purchaseId, lotNumber: null }, select: { stage: true, place: true } });
  await prisma.supplierRawStage.createMany({
    data: src.map((x) => ({ organizationId: orgId, supplierId, purchaseId: purchase.id, stage: x.stage, place: x.place, status: "PLANNED", createdById: s.user.id })),
  });
  refresh(purchase.id);
  return {};
}
