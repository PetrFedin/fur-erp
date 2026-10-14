"use server";

import { redirect } from "next/navigation";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { DATE_RANGE_ERROR, MAX_LINE_QTY, MAX_LINES, isDateInRange } from "@/lib/shipments";
import { acceptLineError, acceptSummaryText, isSide, shipmentTotals, wallNow, wallToDate } from "@/lib/shipment-calc";
import { loadShipmentCandidates, nextShipmentName } from "@/lib/shipment-data";
import { ACCEPT_NEEDS_READY, clip, eventTitles, isReworkState, moveError, REWORK_STATE_LABEL } from "@/lib/shipment-stage";
import { orderLabel } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { readOneDriveFile, removeDriveFileIfUnused, writeDriveFile } from "@/lib/drive-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { guessDocType } from "@/lib/drive-docs";
import { randomUUID } from "node:crypto";

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
  return prisma.shipmentLine.findFirst({ where: { id: lineId, shipment: { organizationId: orgId } }, select: { id: true, shipmentId: true, quantity: true, stage: true } });
}

/** Правка строки: количество, размер, комментарий, принято и возврат. */
export async function updateShipmentLine(lineId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const line = await ownLine(orgId, lineId);
  if (!line) return { error: "Строка не найдена" };
  const q = intField(fd, "quantity");
  if (q === undefined || q === null || q <= 0) return { error: "Количество должно быть целым числом больше 0" };
  const size = str(fd, "size");
  if (size.length > 40) return { error: "Размер не длиннее 40 символов" };
  const comment = str(fd, "comment");
  if (comment.length > 500) return { error: "Комментарий не длиннее 500 символов" };
  const accepted = intField(fd, "acceptedQty");
  const returned = intField(fd, "returnedQty");
  if (accepted === undefined || returned === undefined) return { error: `«Принято» и «Возврат» — целые числа от 0 до ${MAX_LINE_QTY.toLocaleString("ru-RU")} или пусто` };
  const bad = acceptLineError(1, q, accepted, returned);
  if (bad) return { error: bad.replace(/^Строка 1: /, "") };
  const itemNo = str(fd, "itemNo");
  if (itemNo.length > 60) return { error: "№ изделия не длиннее 60 символов" };
  if (line.stage !== "READY" && (accepted != null || returned != null)) return { error: `«Принято» и «Возврат» недоступны: ${ACCEPT_NEEDS_READY}` };
  await prisma.shipmentLine.update({ where: { id: lineId }, data: { quantity: q, size: size || null, comment: comment || null, itemNo: itemNo || null, acceptedQty: accepted, returnedQty: returned } });
  revalidateAll(orgId);
  return { ok: true };
}

export type LineDraft = { id: string; n: number; accepted: number | null; returned: number | null; comment: string | null };

/**
 * «Сохранить» в составе: все изменённые в таблице строки одним действием в одной транзакции.
 * Валидация: целые ≥ 0, принято + возврат не больше «в отгрузке» (меньше можно — «ещё не принято»); ошибка называет номер строки.
 */
export async function saveLineAcceptance(shipmentId: string, drafts: LineDraft[]): Promise<{ error?: string; saved?: number }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return { error: "Отгрузка не найдена" };
  if (!Array.isArray(drafts) || drafts.length === 0) return { error: "Нечего сохранять" };
  if (drafts.length > MAX_LINES * 5) return { error: "Слишком много строк за раз" };
  const own = new Map((await prisma.shipmentLine.findMany({ where: { shipmentId }, select: { id: true, quantity: true, stage: true } })).map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const d of drafts) {
    const line = own.get(d.id);
    if (!line) return { error: `Строка ${d.n}: не найдена в этой отгрузке — обновите страницу` };
    if (seen.has(d.id)) return { error: `Строка ${d.n}: повторяется` };
    seen.add(d.id);
    const bad = acceptLineError(d.n, line.quantity, d.accepted, d.returned);
    if (bad) return { error: bad };
    if (line.stage !== "READY" && (d.accepted != null || d.returned != null)) return { error: `Строка ${d.n}: ${ACCEPT_NEEDS_READY}` };
    for (const v of [d.accepted, d.returned]) if (v != null && v > MAX_LINE_QTY) return { error: `Строка ${d.n}: не больше ${MAX_LINE_QTY.toLocaleString("ru-RU")} шт.` };
    if ((d.comment ?? "").length > 500) return { error: `Строка ${d.n}: комментарий не длиннее 500 символов` };
    if ((d.returned ?? 0) > 0 && !(d.comment ?? "").trim()) return { error: `Строка ${d.n}: укажите, почему не принято` };
  }
  await prisma.$transaction(async (tx) => {
    for (const d of drafts) {
      await tx.shipmentLine.update({ where: { id: d.id }, data: { acceptedQty: d.accepted, returnedQty: d.returned, comment: (d.comment ?? "").trim() || null } });
    }
  });
  revalidateAll(orgId);
  return { saved: drafts.length };
}

/** «Принять всё»: принято = в отгрузке, возврат = 0 по строкам «Готов к отгрузке» (используется в окне приёмки; в таблице то же делается черновиком). */
export async function acceptAllLines(shipmentId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return { error: "Отгрузка не найдена" };
  const lines = await prisma.shipmentLine.findMany({ where: { shipmentId, stage: "READY" }, select: { id: true, quantity: true } });
  if (lines.length === 0) return { error: "Нет строк, готовых к отгрузке: сначала «Принято» по просмотру" };
  await prisma.$transaction(async (tx) => {
    for (const l of lines) await tx.shipmentLine.update({ where: { id: l.id }, data: { acceptedQty: l.quantity, returnedQty: 0 } });
  });
  revalidateAll(orgId);
  return {};
}

/** Строку с приёмкой (принято или возврат больше 0) удалять нельзя. */
export async function deleteShipmentLine(lineId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const line = await prisma.shipmentLine.findFirst({ where: { id: lineId, shipment: { organizationId: orgId } }, select: { id: true, acceptedQty: true, returnedQty: true } });
  if (!line) return { error: "Строка не найдена" };
  if ((line.acceptedQty ?? 0) > 0 || (line.returnedQty ?? 0) > 0) return { error: "Нельзя удалить: по строке есть приёмка. Сначала обнулите «Принято» и «Возврат»." };
  await prisma.shipmentLine.delete({ where: { id: lineId } });
  revalidateAll(orgId);
  return {};
}

// ───────────── этапы ─────────────

type EventData = {
  title: string;
  occurredAt: Date;
  timeKnown: boolean;
  side: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  place: string | null;
  details: string | null;
  docLinks: string | null;
  expected: boolean;
};

/** Ответственный вписывается текстом; если совпал с именем пользователя приложения (без учёта регистра) — связываем с ним. */
async function resolveResponsible(orgId: string, name: string): Promise<{ responsibleUserId: string | null; responsibleName: string | null }> {
  const n = name.trim().slice(0, 120);
  if (!n) return { responsibleUserId: null, responsibleName: null };
  const u = await prisma.user.findFirst({ where: { organizationId: orgId, name: { equals: n, mode: "insensitive" } }, select: { id: true } });
  return { responsibleUserId: u?.id ?? null, responsibleName: n };
}

async function parseEvent(orgId: string, fd: FormData): Promise<EventData | string> {
  const title = str(fd, "title");
  if (!title) return "Укажите название этапа";
  if (title.length > 120) return "Название этапа не длиннее 120 символов";
  const date = str(fd, "date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Укажите дату этапа";
  if (!dateOk(date)) return DATE_RANGE_ERROR;
  const time = str(fd, "time");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "Время укажите в формате ЧЧ:ММ или оставьте пустым";
  const side = str(fd, "side");
  if (side && !isSide(side)) return "«На ком» — Веллмех, ЦУМ или пусто";
  const who = await resolveResponsible(orgId, str(fd, "responsible"));
  const place = str(fd, "place");
  const details = str(fd, "details");
  const docLinks = str(fd, "docLinks");
  if (place.length > 120) return "Место не длиннее 120 символов";
  if (details.length > 4000) return "Детализация не длиннее 4000 символов";
  if (docLinks.length > 2000) return "Ссылки на документы не длиннее 2000 символов";
  return {
    title,
    occurredAt: wallToDate(date, time),
    timeKnown: Boolean(time),
    side: side || null,
    ...who,
    place: place || null,
    details: details || null,
    docLinks: docLinks || null,
    expected: str(fd, "expected") === "on",
  };
}

async function ownShipment(orgId: string, id: string) {
  return prisma.shipment.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
}

// ───────────── файлы этапа ─────────────

/** В форме выбран непустой файл (пустое поле файла браузер всё равно присылает — с пустым именем). */
const hasFile = (fd: FormData, k = "file") => fd.getAll(k).some((e) => typeof e !== "string" && e.name !== "" && e.size > 0);

type ReadFile = Extract<Awaited<ReturnType<typeof readOneDriveFile>>, { file: unknown }>["file"];

/** Проверяет файл формы до любых записей; null — файла в форме нет. */
async function readEventFile(fd: FormData): Promise<{ error: string } | { file: ReadFile } | null> {
  if (!hasFile(fd)) return null;
  const r = await readOneDriveFile(fd);
  return "error" in r ? { error: r.error } : { file: r.file };
}

/** Сохраняет файл на диск и привязывает к этапу (DriveDocument.shipmentEventId). При сбое записи файл с диска убирается. */
async function attachFile(orgId: string, eventId: string, f: ReadFile, title: string | null): Promise<void> {
  const stored = await writeDriveFile(orgId, f);
  try {
    await prisma.driveDocument.create({
      data: {
        organizationId: orgId,
        driveFileId: `local-${randomUUID()}`,
        title: (title ?? "").trim().slice(0, 200) || f.originalName.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 200),
        docType: guessDocType(f.originalName) ?? "OTHER",
        mimeType: stored.storedMime,
        sizeBytes: stored.storedSize,
        ...stored,
        storedAt: new Date(),
        shipmentEventId: eventId,
      },
    });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
}

/** «+ Документ» на этапе в ленте. */
export async function uploadEventDocument(eventId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipment: { organizationId: orgId } }, select: { id: true } });
  if (!cur) return { error: "Этап не найден" };
  if (!hasFile(fd)) return { error: "Выберите файл" };
  const f = await readEventFile(fd);
  if (!f || "error" in f) return { error: f?.error ?? "Выберите файл" };
  await attachFile(orgId, cur.id, f.file, str(fd, "title"));
  revalidateAll(orgId);
  return { ok: true };
}

export async function removeEventDocument(docId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({ where: { id: docId, organizationId: orgId, shipmentEventId: { not: null } }, select: { id: true, storagePath: true } });
  if (!doc) return { error: "Документ не найден" };
  await prisma.driveDocument.delete({ where: { id: doc.id } });
  await removeDriveFileIfUnused(doc.storagePath);
  revalidateAll(orgId);
  return {};
}

/** «+ Этап». Файл (необязательно) прикрепляется в той же отправке: сначала проверяется, потом этап создаётся. При заполненном «Следующий этап» создаётся ожидаемый этап. */
export async function createEvent(shipmentId: string, _prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return { error: "Отгрузка не найдена" };
  const e = await parseEvent(orgId, fd);
  if (typeof e === "string") return { error: e };
  const file = await readEventFile(fd);
  if (file && "error" in file) return { error: file.error };
  const nextTitle = str(fd, "nextTitle");
  const nextDate = str(fd, "nextDate");
  const nextTime = str(fd, "nextTime");
  if (nextTitle) {
    if (nextTitle.length > 120) return { error: "Название следующего этапа не длиннее 120 символов" };
    if (!dateOk(nextDate)) return { error: "Укажите ожидаемую дату следующего этапа" };
    if (nextTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(nextTime)) return { error: "Время следующего этапа — ЧЧ:ММ или пусто" };
  }
  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.shipmentEvent.create({ data: { shipmentId, ...e, createdById: session.user.id } });
    if (nextTitle) {
      await tx.shipmentEvent.create({
        data: { shipmentId, title: nextTitle, occurredAt: wallToDate(nextDate, nextTime), timeKnown: Boolean(nextTime), expected: true, createdById: session.user.id },
      });
    }
    return ev;
  });
  if (file) {
    try {
      await attachFile(orgId, created.id, file.file, null);
    } catch {
      revalidateAll(orgId);
      return { error: "Этап добавлен, но файл прикрепить не удалось — загрузите его кнопкой «+ Документ» на этапе", id: created.id };
    }
  }
  revalidateAll(orgId);
  return { ok: true, id: created.id };
}

export async function updateEvent(eventId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipment: { organizationId: orgId } }, select: { id: true } });
  if (!cur) return { error: "Этап не найден" };
  const e = await parseEvent(orgId, fd);
  if (typeof e === "string") return { error: e };
  const file = await readEventFile(fd);
  if (file && "error" in file) return { error: file.error };
  await prisma.shipmentEvent.update({ where: { id: eventId }, data: { ...e, updatedById: session.user.id } });
  if (file) await attachFile(orgId, eventId, file.file, null);
  revalidateAll(orgId);
  return { ok: true };
}

/** Удаление этапа: файлы этапа убираются с диска; если это был этап подтверждённой приёмки — приёмка снимается. */
export async function deleteEvent(eventId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({
    where: { id: eventId, shipment: { organizationId: orgId } },
    select: { id: true, shipmentId: true, documents: { select: { storagePath: true } } },
  });
  if (!cur) return { error: "Этап не найден" };
  await prisma.$transaction(async (tx) => {
    await tx.shipment.updateMany({ where: { id: cur.shipmentId, acceptEventId: eventId }, data: { acceptedAt: null, acceptedBy: null, acceptEventId: null, status: "PLANNED" } });
    await tx.shipmentEvent.delete({ where: { id: eventId } });
  });
  for (const d of cur.documents) await removeDriveFileIfUnused(d.storagePath);
  revalidateAll(orgId);
  return {};
}

/** Ожидаемый этап → выполненный: дата и время «сейчас» (потом правятся окном «Изменить»). Этап приёмки подтверждается кнопкой «ПРИНЯТО». */
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

// ───────────── приёмка в Коптево ─────────────

/** Нет ожидаемого этапа приёмки: «+ Приёмка в Коптево» создаёт его (дата — плановая дата отгрузки). */
export async function createAcceptanceEvent(shipmentId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const sh = await prisma.shipment.findFirst({ where: { id: shipmentId, organizationId: orgId }, select: { id: true, plannedDate: true, acceptedAt: true } });
  if (!sh) return { error: "Отгрузка не найдена" };
  if (sh.acceptedAt) return { error: "Приёмка уже подтверждена" };
  await prisma.shipmentEvent.create({
    data: { shipmentId, title: "Принято в Коптево", occurredAt: sh.plannedDate, timeKnown: false, expected: true, place: "Коптево", createdById: session.user.id },
  });
  revalidateAll(orgId);
  return {};
}

/**
 * Кнопка «ПРИНЯТО»: этап приёмки становится выполненным (дата-время из окна, details — автосводка по строкам),
 * у отгрузки фиксируются acceptedAt, кто принял и этап; статус — «Принята».
 */
export async function confirmAcceptance(shipmentId: string, eventId: string, fd: FormData): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const sh = await prisma.shipment.findFirst({
    where: { id: shipmentId, organizationId: orgId },
    select: { id: true, acceptedAt: true, lines: { where: { stage: "READY" }, select: { quantity: true, acceptedQty: true, returnedQty: true } } },
  });
  if (!sh) return { error: "Отгрузка не найдена" };
  if (sh.acceptedAt) return { error: "Приёмка уже подтверждена" };
  const ev = await prisma.shipmentEvent.findFirst({ where: { id: eventId, shipmentId, expected: true }, select: { id: true } });
  if (!ev) return { error: "Ожидаемый этап приёмки не найден — обновите страницу" };
  const date = str(fd, "date");
  if (!dateOk(date)) return { error: "Укажите дату приёмки" };
  const time = str(fd, "time");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Время укажите в формате ЧЧ:ММ или оставьте пустым" };
  const side = str(fd, "side");
  if (side && !isSide(side)) return { error: "«На ком» — Веллмех, ЦУМ или пусто" };
  const comment = str(fd, "comment");
  if (comment.length > 1000) return { error: "Комментарий не длиннее 1000 символов" };
  const who = await resolveResponsible(orgId, str(fd, "acceptedBy"));
  const t = shipmentTotals(sh.lines);
  if (t.filledLines === 0) return { error: "Сначала отметьте «Принято» / «Не принято» в списке товаров на приёмке в Коптево (или нажмите «Принять все по списку»)" };
  const at = wallToDate(date, time);
  const details = [acceptSummaryText(t), comment].filter(Boolean).join("\n");
  await prisma.$transaction(async (tx) => {
    await tx.shipmentEvent.update({
      where: { id: ev.id },
      data: { expected: false, occurredAt: at, timeKnown: Boolean(time), side: side || null, ...who, details, updatedById: session.user.id },
    });
    await tx.shipment.update({ where: { id: shipmentId }, data: { acceptedAt: at, acceptedBy: who.responsibleName, acceptEventId: ev.id, status: "ACCEPTED" } });
  });
  revalidateAll(orgId);
  return { ok: true };
}

/** «Отменить приёмку»: этап снова ожидаемый, acceptedAt снимается, статус — «Запланирована». */
export async function cancelAcceptance(shipmentId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const sh = await prisma.shipment.findFirst({ where: { id: shipmentId, organizationId: orgId }, select: { id: true, acceptedAt: true, acceptEventId: true } });
  if (!sh) return { error: "Отгрузка не найдена" };
  if (!sh.acceptedAt) return { error: "Приёмка не подтверждена" };
  await prisma.$transaction(async (tx) => {
    if (sh.acceptEventId) {
      await tx.shipmentEvent.updateMany({ where: { id: sh.acceptEventId, shipmentId }, data: { expected: true, details: null, updatedById: session.user.id } });
    }
    await tx.shipment.update({ where: { id: shipmentId }, data: { acceptedAt: null, acceptedBy: null, acceptEventId: null, status: "PLANNED" } });
  });
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

// ───────────── стадии строк: просмотр → доработка → готов к отгрузке ─────────────

export type ReworkInput = { id?: string; text: string; state: string; note: string };
type StageResult = { error?: string; ok?: boolean; changed?: number };

const lineSel = {
  id: true, shipmentId: true, stage: true, itemNo: true, size: true, color: true, acceptedQty: true, returnedQty: true, productionOrderId: true,
  productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModel: { select: { name: true } } } },
  reworks: { select: { id: true, state: true, text: true } },
} as const;

/** «M018 р. 44 №259» — короткое имя строки для названий этапов. */
function articleOf(l: { size: string | null; itemNo: string | null; productionOrder: { productModel: { name: string } } }): string {
  return [l.productionOrder.productModel.name, l.size ? `р. ${l.size}` : "", l.itemNo ? `№${l.itemNo}` : ""].filter(Boolean).join(" ");
}

async function lineDetails(orgId: string, lines: { id: string; size: string | null; itemNo: string | null; productionOrder: { id: string; number: string; workOrderNumber: string | null; productModel: { name: string } } }[]): Promise<string> {
  const pos = await loadTzPositions(orgId, lines.map((l) => l.productionOrder));
  return lines.map((l) => `${orderLabel({ workOrderNumber: l.productionOrder.workOrderNumber, number: l.productionOrder.number, ...pos.get(l.productionOrder.id) })} · ${articleOf(l)}`).join("\n").slice(0, 3900);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Автоэтап хронологии: «сейчас», время известно, ответственный — нажавший кнопку, «на ком» не заполняется. */
async function stageEvent(tx: Tx, shipmentId: string, userId: string, title: string, details: string | null) {
  await tx.shipmentEvent.create({ data: { shipmentId, title, occurredAt: wallNow(), timeKnown: true, responsibleUserId: userId, details, createdById: userId } });
}

async function loadOwnLines(orgId: string, shipmentId: string, ids?: string[]) {
  return prisma.shipmentLine.findMany({ where: { shipmentId, shipment: { organizationId: orgId }, ...(ids ? { id: { in: ids } } : {}) }, select: lineSel });
}

/** Кнопка «Принято» (по просмотру): REVIEW → READY. Одна строка — этап «Принято по просмотру: <артикул>», несколько — один этап «N строк». */
export async function acceptLinesByReview(shipmentId: string, lineIds: string[]): Promise<StageResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!Array.isArray(lineIds) || lineIds.length === 0) return { error: "Нет строк на просмотре" };
  const ids = [...new Set(lineIds)];
  const lines = await loadOwnLines(orgId, shipmentId, ids);
  if (lines.length !== ids.length) return { error: "Строка не найдена — обновите страницу" };
  for (const l of lines) {
    if (l.stage === "READY") return { error: `${articleOf(l)}: уже готов к отгрузке` };
    const bad = moveError(l.stage, "TO_READY", l.reworks, false);
    if (bad) return { error: `${articleOf(l)}: ${bad}` };
  }
  const at = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.shipmentLine.updateMany({ where: { id: { in: ids } }, data: { stage: "READY", stageChangedAt: at, stageChangedBy: session.user.id } });
    const details = await lineDetails(orgId, lines);
    await stageEvent(tx, shipmentId, session.user.id, lines.length === 1 ? eventTitles.accepted(articleOf(lines[0])) : eventTitles.acceptedMany(lines.length), details);
  });
  revalidateAll(orgId);
  return { ok: true, changed: ids.length };
}

/** «Принято всё, что на просмотре»: все строки REVIEW → READY одним этапом. */
export async function acceptAllOnReview(shipmentId: string): Promise<StageResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(orgId, shipmentId))) return { error: "Отгрузка не найдена" };
  const lines = await prisma.shipmentLine.findMany({ where: { shipmentId, stage: "REVIEW" }, select: { id: true } });
  if (lines.length === 0) return { error: "Нет строк на просмотре" };
  return acceptLinesByReview(shipmentId, lines.map((l) => l.id));
}

function cleanItems(items: ReworkInput[]): ReworkInput[] | string {
  if (!Array.isArray(items)) return "Нечего сохранять";
  const out: ReworkInput[] = [];
  for (const it of items) {
    const text = (it.text ?? "").trim();
    const note = (it.note ?? "").trim();
    if (!text) continue;
    if (text.length > 1000) return "Пункт доработки не длиннее 1000 символов";
    if (note.length > 1000) return "Комментарий к пункту не длиннее 1000 символов";
    if (!isReworkState(it.state)) return "Неизвестное состояние пункта доработки";
    out.push({ id: it.id, text, state: it.state, note });
  }
  return out;
}

/** «На доработку» (из просмотра) и «Вернуть на доработку» (из «Готов к отгрузке»): обязателен хотя бы один пункт «что именно». */
export async function sendLineToRework(lineId: string, items: ReworkInput[]): Promise<StageResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const line = (await prisma.shipmentLine.findMany({ where: { id: lineId, shipment: { organizationId: orgId } }, select: lineSel }))[0];
  if (!line) return { error: "Строка не найдена" };
  const cleaned = cleanItems(items.map((i) => ({ ...i, state: "OPEN" })));
  if (typeof cleaned === "string") return { error: cleaned };
  if (cleaned.length === 0) return { error: "Укажите, что именно нужно доработать" };
  const bad = moveError(line.stage, "TO_REWORK", line.reworks, line.acceptedQty != null || line.returnedQty != null);
  if (bad) return { error: bad };
  const at = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.shipmentLine.update({ where: { id: lineId }, data: { stage: "REWORK", stageChangedAt: at, stageChangedBy: session.user.id } });
    for (const it of cleaned) await tx.shipmentLineRework.create({ data: { lineId, text: it.text, note: it.note || null, state: "OPEN", createdById: session.user.id } });
    const first = cleaned[0].text;
    await stageEvent(tx, line.shipmentId, session.user.id, eventTitles.rework(articleOf(line), first),
      [(await lineDetails(orgId, [line])), ...cleaned.map((c, i) => `${i + 1}. ${c.text}`), line.stage === "READY" ? "Возврат из «Готов к отгрузке»" : ""].filter(Boolean).join("\n"));
  });
  revalidateAll(orgId);
  return { ok: true };
}

/** «Сохранить» в окне доработки: правка пунктов (текст, состояние, комментарий), новые пункты. Только пока строка на доработке. */
export async function saveLineReworks(lineId: string, items: ReworkInput[]): Promise<StageResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const line = (await prisma.shipmentLine.findMany({ where: { id: lineId, shipment: { organizationId: orgId } }, select: lineSel }))[0];
  if (!line) return { error: "Строка не найдена" };
  if (line.stage !== "REWORK") return { error: "Строка не на доработке" };
  const cleaned = cleanItems(items);
  if (typeof cleaned === "string") return { error: cleaned };
  const own = new Map(line.reworks.map((r) => [r.id, r]));
  for (const it of cleaned) if (it.id && !own.has(it.id)) return { error: "Пункт доработки не найден — обновите страницу" };
  if (cleaned.length === 0) return { error: "Должен остаться хотя бы один пункт доработки" };
  const keep = new Set(cleaned.filter((c) => c.id).map((c) => c.id!));
  await prisma.$transaction(async (tx) => {
    for (const r of line.reworks) if (!keep.has(r.id)) await tx.shipmentLineRework.delete({ where: { id: r.id } });
    for (const it of cleaned) {
      if (it.id) await tx.shipmentLineRework.update({ where: { id: it.id }, data: { text: it.text, state: it.state as "OPEN" | "DONE" | "MORE", note: it.note || null, updatedById: session.user.id } });
      else await tx.shipmentLineRework.create({ data: { lineId, text: it.text, state: it.state as "OPEN" | "DONE" | "MORE", note: it.note || null, createdById: session.user.id } });
    }
  });
  revalidateAll(orgId);
  return { ok: true };
}

/** «Принято после доработки»: REWORK → READY, когда все пункты исправлены и приняты. Можно сразу с сохранением пунктов из окна. */
export async function acceptAfterRework(lineId: string, items?: ReworkInput[]): Promise<StageResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (items) {
    const r = await saveLineReworks(lineId, items);
    if (r.error) return r;
  }
  const line = (await prisma.shipmentLine.findMany({ where: { id: lineId, shipment: { organizationId: orgId } }, select: lineSel }))[0];
  if (!line) return { error: "Строка не найдена" };
  if (line.stage !== "REWORK") return { error: "Строка не на доработке" };
  const bad = moveError(line.stage, "TO_READY", line.reworks, false);
  if (bad) return { error: bad };
  const at = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.shipmentLine.update({ where: { id: lineId }, data: { stage: "READY", stageChangedAt: at, stageChangedBy: session.user.id } });
    await stageEvent(tx, line.shipmentId, session.user.id, eventTitles.afterRework(articleOf(line)),
      [await lineDetails(orgId, [line]), ...line.reworks.map((r, i) => `${i + 1}. ${clip(r.text, 200)} — ${REWORK_STATE_LABEL[r.state]}`)].join("\n"));
  });
  revalidateAll(orgId);
  return { ok: true };
}
