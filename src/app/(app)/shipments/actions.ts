"use server";

import { redirect } from "next/navigation";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { DATE_RANGE_ERROR, MAX_LINE_QTY, MAX_LINES, isDateInRange } from "@/lib/shipments";
import { wallNow, wallToDate } from "@/lib/shipment-calc";
import { loadShipmentCandidates, nextShipmentName } from "@/lib/shipment-data";

// Так же, как в разделе ТЗ: отгрузки ведут те, кто ведёт ТЗ.
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type ShipmentFormState = { error?: string; ok?: boolean; id?: string };
type EditResult = { error?: string; ok?: boolean };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && isDateInRange(s);

/** Целое ≥ 0 из поля формы; пусто — null; не число — undefined (ошибка). */
function intField(fd: FormData, k: string): number | null | undefined {
  const raw = str(fd, k).replace(/\s/g, "");
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > MAX_LINE_QTY ? undefined : n;
}

// ───────────── шапка отгрузки ─────────────

type Header = { name: string; supplierId: string | null; batchId: string | null; plannedDate: string; notes: string | null };

async function parseHeader(orgId: string, fd: FormData, nameFallback: () => Promise<string>): Promise<Header | string> {
  const name = str(fd, "name") || (await nameFallback());
  if (name.length > 120) return "Название не длиннее 120 символов";
  const plannedDate = str(fd, "plannedDate");
  if (!plannedDate || !/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) return "Укажите плановую дату";
  if (!dateOk(plannedDate)) return DATE_RANGE_ERROR;
  const notes = str(fd, "notes");
  if (notes.length > 2000) return "Примечание не длиннее 2000 символов";
  const supplierId = str(fd, "supplierId") || null;
  const batchId = str(fd, "batchId") || null;
  const bad = await checkOrgRefs(orgId, { supplier: supplierId });
  if (bad) return bad;
  if (batchId && !(await prisma.productionBatch.findFirst({ where: { id: batchId, organizationId: orgId }, select: { id: true } }))) return "Партия не найдена";
  return { name, supplierId, batchId, plannedDate, notes: notes || null };
}

/** «+ Отгрузка»: создаёт карточку и переходит на неё. */
export async function createShipment(_prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const h = await parseHeader(orgId, fd, () => nextShipmentName(orgId, str(fd, "plannedDate")));
  if (typeof h === "string") return { error: h };
  const s = await prisma.shipment.create({
    data: { organizationId: orgId, name: h.name, supplierId: h.supplierId, batchId: h.batchId, plannedDate: new Date(h.plannedDate), notes: h.notes, createdById: session.user.id },
  });
  revalidateAll(orgId);
  redirect(`/shipments/${s.id}`);
}

export async function updateShipmentHeader(id: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } });
  if (!cur) return { error: "Отгрузка не найдена" };
  const h = await parseHeader(orgId, fd, async () => cur.name ?? "Отгрузка");
  if (typeof h === "string") return { error: h };
  await prisma.shipment.update({ where: { id }, data: { name: h.name, supplierId: h.supplierId, batchId: h.batchId, plannedDate: new Date(h.plannedDate), notes: h.notes } });
  revalidateAll(orgId);
  return { ok: true };
}

/** Удалить можно, пока нет ни одного этапа (а значит, и приёмки). */
export async function deleteShipment(id: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const s = await prisma.shipment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, _count: { select: { events: true } } } });
  if (!s) return { error: "Отгрузка не найдена" };
  if (s._count.events > 0) return { error: "Нельзя удалить: в отгрузке есть этапы. Сначала удалите их." };
  await prisma.shipment.delete({ where: { id } });
  revalidateAll(orgId);
  return {};
}

// ───────────── состав ─────────────

/** Добавить позиции ТЗ в состав. Цвет, размер и вид меха берутся из ТЗ на сервере; та же позиция суммируется со строкой отгрузки. */
export async function addShipmentLines(shipmentId: string, items: { key: string; qty: number }[]): Promise<{ error?: string; added?: number }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const sh = await prisma.shipment.findFirst({ where: { id: shipmentId, organizationId: orgId }, select: { id: true } });
  if (!sh) return { error: "Отгрузка не найдена" };
  if (!Array.isArray(items) || items.length === 0) return { error: "Отметьте хотя бы одну позицию с количеством" };
  if (items.length > MAX_LINES) return { error: `Не больше ${MAX_LINES} строк за раз` };
  for (const it of items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) return { error: "Количество должно быть целым числом больше 0" };
    if (it.qty > MAX_LINE_QTY) return { error: `Количество в строке не больше ${MAX_LINE_QTY.toLocaleString("ru-RU")} шт.` };
  }
  const cands = new Map((await loadShipmentCandidates(orgId, shipmentId)).map((c) => [c.key, c]));
  const picked = new Map<string, number>();
  for (const it of items) picked.set(it.key, (picked.get(it.key) ?? 0) + it.qty);
  for (const k of picked.keys()) if (!cands.has(k)) return { error: "Позиция ТЗ изменилась или отменена — обновите окно и выберите заново" };
  await prisma.$transaction(async (tx) => {
    for (const [key, qty] of picked) {
      const c = cands.get(key)!;
      const cur = await tx.shipmentLine.findFirst({ where: { shipmentId, productionOrderId: c.orderId, color: c.color, size: c.size } });
      if (cur) await tx.shipmentLine.update({ where: { id: cur.id }, data: { quantity: cur.quantity + qty } });
      else await tx.shipmentLine.create({ data: { shipmentId, productionOrderId: c.orderId, color: c.color, size: c.size, furKind: c.furKind || null, quantity: qty } });
    }
  });
  revalidateAll(orgId);
  return { added: picked.size };
}

async function ownLine(orgId: string, lineId: string) {
  return prisma.shipmentLine.findFirst({ where: { id: lineId, shipment: { organizationId: orgId } }, select: { id: true, shipmentId: true } });
}

export async function updateShipmentLine(lineId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownLine(orgId, lineId))) return { error: "Строка не найдена" };
  const q = intField(fd, "quantity");
  if (q === undefined || q === null || q <= 0) return { error: "Количество должно быть целым числом больше 0" };
  const size = str(fd, "size");
  if (size.length > 40) return { error: "Размер не длиннее 40 символов" };
  const comment = str(fd, "comment");
  if (comment.length > 500) return { error: "Комментарий не длиннее 500 символов" };
  await prisma.shipmentLine.update({ where: { id: lineId }, data: { quantity: q, size: size || null, comment: comment || null } });
  revalidateAll(orgId);
  return { ok: true };
}

/** Строку с приёмкой (принято / не принято / возвращено хотя бы по одному этапу) удалять нельзя. */
export async function deleteShipmentLine(lineId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownLine(orgId, lineId))) return { error: "Строка не найдена" };
  const touched = await prisma.shipmentEventLine.count({
    where: { shipmentLineId: lineId, OR: [{ accepted: { not: null } }, { rejected: { not: null } }, { returned: { not: null } }] },
  });
  if (touched > 0) return { error: "Нельзя удалить: по строке есть приёмка. Сначала уберите её из этапов." };
  await prisma.shipmentLine.delete({ where: { id: lineId } });
  revalidateAll(orgId);
  return {};
}

// ───────────── этапы ─────────────

type EventData = {
  title: string;
  occurredAt: Date;
  timeKnown: boolean;
  responsibleUserId: string | null;
  responsibleName: string | null;
  place: string | null;
  details: string | null;
  docLinks: string | null;
  expected: boolean;
  lines: { shipmentLineId: string; qty: number | null; accepted: number | null; rejected: number | null; returned: number | null; comment: string | null }[];
};

async function parseEvent(orgId: string, shipmentId: string, fd: FormData): Promise<EventData | string> {
  const title = str(fd, "title");
  if (!title) return "Укажите название этапа";
  if (title.length > 120) return "Название этапа не длиннее 120 символов";
  const date = str(fd, "date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Укажите дату этапа";
  if (!dateOk(date)) return DATE_RANGE_ERROR;
  const time = str(fd, "time");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "Время укажите в формате ЧЧ:ММ или оставьте пустым";
  const resp = str(fd, "responsible");
  let responsibleUserId: string | null = null;
  let responsibleName: string | null = null;
  if (resp && resp !== "__other") {
    const u = await prisma.user.findFirst({ where: { id: resp, organizationId: orgId }, select: { id: true } });
    if (!u) return "Ответственный не найден";
    responsibleUserId = u.id;
  } else if (resp === "__other") {
    responsibleName = str(fd, "responsibleName").slice(0, 120) || null;
  }
  const place = str(fd, "place");
  const details = str(fd, "details");
  const docLinks = str(fd, "docLinks");
  if (place.length > 120) return "Место не длиннее 120 символов";
  if (details.length > 4000) return "Детализация не длиннее 4000 символов";
  if (docLinks.length > 2000) return "Ссылки на документы не длиннее 2000 символов";

  const lines: EventData["lines"] = [];
  if (str(fd, "mode") === "lines") {
    const own = await prisma.shipmentLine.findMany({ where: { shipmentId }, select: { id: true } });
    for (const l of own) {
      const f = (n: string) => intField(fd, `l_${l.id}_${n}`);
      const qty = f("qty"), accepted = f("accepted"), rejected = f("rejected"), returned = f("returned");
      if ([qty, accepted, rejected, returned].includes(undefined)) return `Количества по строкам — целые числа от 0 до ${MAX_LINE_QTY.toLocaleString("ru-RU")}`;
      const comment = str(fd, `l_${l.id}_comment`).slice(0, 500) || null;
      if (qty == null && accepted == null && rejected == null && returned == null && !comment) continue;
      lines.push({ shipmentLineId: l.id, qty: qty ?? null, accepted: accepted ?? null, rejected: rejected ?? null, returned: returned ?? null, comment });
    }
  }
  return {
    title,
    occurredAt: wallToDate(date, time),
    timeKnown: Boolean(time),
    responsibleUserId,
    responsibleName,
    place: place || null,
    details: details || null,
    docLinks: docLinks || null,
    expected: str(fd, "expected") === "on",
    lines,
  };
}

async function ownShipment(orgId: string, id: string) {
  return prisma.shipment.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
}

/** «+ Этап». При заполненном блоке «Следующий этап» в той же транзакции создаётся ожидаемый этап. */
export async function createEvent(shipmentId: string, _prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return { error: "Отгрузка не найдена" };
  const e = await parseEvent(orgId, shipmentId, fd);
  if (typeof e === "string") return { error: e };
  const nextTitle = str(fd, "nextTitle");
  const nextDate = str(fd, "nextDate");
  const nextTime = str(fd, "nextTime");
  if (nextTitle) {
    if (nextTitle.length > 120) return { error: "Название следующего этапа не длиннее 120 символов" };
    if (!dateOk(nextDate)) return { error: "Укажите ожидаемую дату следующего этапа" };
    if (nextTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(nextTime)) return { error: "Время следующего этапа — ЧЧ:ММ или пусто" };
  }
  const { lines, ...data } = e;
  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.shipmentEvent.create({
      data: { shipmentId, ...data, createdById: session.user.id, lines: { create: lines } },
    });
    if (nextTitle) {
      await tx.shipmentEvent.create({
        data: { shipmentId, title: nextTitle, occurredAt: wallToDate(nextDate, nextTime), timeKnown: Boolean(nextTime), expected: true, createdById: session.user.id },
      });
    }
    return ev;
  });
  revalidateAll(orgId);
  return { ok: true, id: created.id };
}

export async function updateEvent(eventId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipment: { organizationId: orgId } }, select: { id: true, shipmentId: true } });
  if (!cur) return { error: "Этап не найден" };
  const e = await parseEvent(orgId, cur.shipmentId, fd);
  if (typeof e === "string") return { error: e };
  const { lines, ...data } = e;
  await prisma.$transaction(async (tx) => {
    await tx.shipmentEventLine.deleteMany({ where: { eventId } });
    await tx.shipmentEvent.update({ where: { id: eventId }, data: { ...data, updatedById: session.user.id, lines: { create: lines } } });
  });
  revalidateAll(orgId);
  return { ok: true };
}

export async function deleteEvent(eventId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipment: { organizationId: orgId } }, select: { id: true } });
  if (!cur) return { error: "Этап не найден" };
  await prisma.shipmentEvent.delete({ where: { id: eventId } });
  revalidateAll(orgId);
  return {};
}

/** Ожидаемый этап → выполненный: дата и время «сейчас» (потом правятся окном «Изменить этап»). */
export async function markEventDone(eventId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipment: { organizationId: orgId } }, select: { id: true, expected: true } });
  if (!cur) return { error: "Этап не найден" };
  if (!cur.expected) return { error: "Этап уже отмечен выполненным" };
  await prisma.shipmentEvent.update({ where: { id: eventId }, data: { expected: false, occurredAt: wallNow(), timeKnown: true, updatedById: session.user.id } });
  revalidateAll(orgId);
  return {};
}

/** Для окна «+ Добавить из ТЗ»: позиции загруженных ТЗ с остатками (грузится при открытии окна). */
export async function listShipmentCandidates(shipmentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return [];
  return loadShipmentCandidates(orgId, shipmentId);
}
