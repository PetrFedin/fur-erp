"use server";

import { redirect } from "next/navigation";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { DATE_RANGE_ERROR, MAX_LINE_QTY, MAX_LINES } from "@/lib/shipments";
import { ACCEPTANCE_TITLE, FITTING_TITLE, acceptLineError, sideError, wallNow, wallToDate } from "@/lib/shipment-calc";
import { loadShipmentCandidates, nextShipmentName } from "@/lib/shipment-data";
import { ACCEPT_NEEDS_READY } from "@/lib/shipment-stage";
import { readOneDriveFile, removeDriveFileIfUnused, writeDriveFile } from "@/lib/drive-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { guessDocType } from "@/lib/drive-docs";
import { randomUUID } from "node:crypto";
import { EDIT_ROLES, type Sess, isSupplier, shipmentScope, type EditResult, str, dateOk, resolveResponsible, ownShipment } from "./shared";

// Этапы хронологии ведёт ещё и внешний поставщик (Веллмех) — только в своих отгрузках и только свои этапы.
const EVENT_ROLES = [...EDIT_ROLES, "SUPPLIER"] as const;

/** Этап по id в пределах доступного: поставщик видит для правки только этапы, которые внёс сам. */
const eventWhere = (s: Sess, id: string) => ({ id, shipment: shipmentScope(s), ...(isSupplier(s) ? { createdById: s.user.id } : {}) });

/** Поставщик не заводит этапы приёмки и примерки в Коптево — их ведёт наша сторона. */
const supplierTitleError = (s: Sess, title: string, place: string | null): string | null =>
  isSupplier(s) && (/принят|приёмк|приемк|^примерк/i.test(title) || /коптево/i.test(place ?? "")) ? "Приёмку и примерку в Коптево отмечает ЦУМ" : null;

export type ShipmentFormState = { error?: string; ok?: boolean; id?: string };

/** Целое ≥ 0 из поля формы; пусто — null; не число — undefined (ошибка). */
function intField(fd: FormData, k: string): number | null | undefined {
  const raw = str(fd, k).replace(/\s/g, "");
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > MAX_LINE_QTY ? undefined : n;
}

// ───────────── шапка отгрузки ─────────────

type Header = { name: string; supplierId: string | null; batchId: string | null; plannedDate: string; notes: string | null; fittingDate: string | null };

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
  // Дата примерки (только при создании, необязательно): по ней заводится ожидаемый этап «Примерка».
  const fittingDate = str(fd, "fittingDate");
  if (fittingDate && !dateOk(fittingDate)) return DATE_RANGE_ERROR;
  return { name, supplierId, batchId, plannedDate, notes: notes || null, fittingDate: fittingDate || null };
}

/** «+ Отгрузка»: создаёт карточку и переходит на неё. */
export async function createShipment(_prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const h = await parseHeader(orgId, fd, () => nextShipmentName(orgId, str(fd, "plannedDate")));
  if (typeof h === "string") return { error: h };
  const s = await prisma.$transaction(async (tx) => {
    const sh = await tx.shipment.create({
      data: { organizationId: orgId, name: h.name, supplierId: h.supplierId, batchId: h.batchId, plannedDate: new Date(h.plannedDate), notes: h.notes, createdById: session.user.id },
    });
    if (h.fittingDate) {
      await tx.shipmentEvent.create({
        data: { shipmentId: sh.id, title: FITTING_TITLE, occurredAt: wallToDate(h.fittingDate), timeKnown: false, expected: true, side: "WELLMEKH", createdById: session.user.id },
      });
    }
    return sh;
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

/** Удалить можно, пока приёмка не закрыта: этапы и состав удаляются вместе с отгрузкой. */
export async function deleteShipment(id: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const s = await prisma.shipment.findFirst({ where: { id, organizationId: orgId }, select: { id: true, acceptedAt: true } });
  if (!s) return { error: "Отгрузка не найдена" };
  if (s.acceptedAt) return { error: "Приёмка закрыта — отгрузку удалить нельзя" };
  await prisma.shipment.delete({ where: { id } });
  revalidateAll(orgId);
  return {};
}

// ───────────── состав ─────────────

/** Добавить позиции ТЗ в состав. Цвет, размер и вид меха берутся из ТЗ на сервере; та же позиция суммируется со строкой отгрузки. */
export async function addShipmentLines(shipmentId: string, items: { key: string; qty: number }[], asReady = false): Promise<{ error?: string; added?: number }> {
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
      if (cur) await tx.shipmentLine.update({ where: { id: cur.id }, data: { quantity: cur.quantity + qty, ...(asReady ? { stage: "READY" } : {}) } });
      else await tx.shipmentLine.create({ data: { shipmentId, productionOrderId: c.orderId, color: c.color, size: c.size, furKind: c.furKind || null, quantity: qty, ...(asReady ? { stage: "READY" } : {}) } });
    }
  });
  revalidateAll(orgId);
  return { added: picked.size };
}

/** «Свой артикул»: строка без ТЗ — для изделия, которого ещё нет в ТЗ (артикул, цвет, размер, вид меха, количество). Та же строка суммируется. */
export async function addCustomShipmentLine(shipmentId: string, fd: FormData, asReady = false): Promise<EditResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(session, shipmentId))) return { error: "Отгрузка не найдена" };
  const article = str(fd, "article");
  if (!article) return { error: "Укажите артикул или название" };
  if (article.length > 120) return { error: "Артикул не длиннее 120 символов" };
  const color = str(fd, "color"), size = str(fd, "size"), furKind = str(fd, "furKind");
  if (color.length > 80 || furKind.length > 80) return { error: "Цвет и вид меха — не длиннее 80 символов" };
  if (size.length > 40) return { error: "Размер не длиннее 40 символов" };
  const qty = intField(fd, "quantity");
  if (qty === undefined || qty === null || qty <= 0) return { error: "Количество должно быть целым числом больше 0" };
  const where = { shipmentId, productionOrderId: null, customArticle: article, color: color || null, size: size || null };
  const tooMany = await prisma.$transaction(async (tx) => {
    const cur = await tx.shipmentLine.findFirst({ where });
    if (!cur) {
      await tx.shipmentLine.create({ data: { ...where, furKind: furKind || null, quantity: qty, ...(asReady ? { stage: "READY" } : {}) } });
      return false;
    }
    if (cur.quantity + qty > MAX_LINE_QTY) return true;
    await tx.shipmentLine.update({ where: { id: cur.id }, data: { quantity: cur.quantity + qty, ...(asReady ? { stage: "READY" } : {}) } });
    return false;
  });
  if (tooMany) return { error: `Количество в строке не больше ${MAX_LINE_QTY.toLocaleString("ru-RU")} шт.` };
  revalidateAll(orgId);
  return { ok: true };
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
  if (!(await ownShipment(session, shipmentId))) return { error: "Отгрузка не найдена" };
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
  if (!(await ownShipment(session, shipmentId))) return { error: "Отгрузка не найдена" };
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

async function parseEvent(session: Sess, fd: FormData): Promise<EventData | string> {
  const orgId = session.user.organizationId;
  const title = str(fd, "title");
  if (!title) return "Укажите название этапа";
  if (title.length > 120) return "Название этапа не длиннее 120 символов";
  const date = str(fd, "date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Укажите дату этапа";
  if (!dateOk(date)) return DATE_RANGE_ERROR;
  const time = str(fd, "time");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "Время укажите в формате ЧЧ:ММ или оставьте пустым";
  const side = isSupplier(session) ? "WELLMEKH" : str(fd, "side");
  const sideErr = sideError(side);
  if (sideErr) return sideErr;
  const who = await resolveResponsible(orgId, str(fd, "responsible"));
  const place = str(fd, "place");
  const bad = supplierTitleError(session, title, place);
  if (bad) return bad;
  const details = str(fd, "details");
  const docLinks = str(fd, "docLinks");
  if (place.length > 120) return "Место не длиннее 120 символов";
  if (details.length > 4000) return "Детализация не длиннее 4000 символов";
  if (docLinks.length > 2000) return "Ссылки на документы не длиннее 2000 символов";
  return {
    title,
    occurredAt: wallToDate(date, time),
    timeKnown: Boolean(time),
    side,
    ...who,
    place: place || null,
    details: details || null,
    docLinks: docLinks || null,
    expected: str(fd, "expected") === "on",
  };
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
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: eventWhere(session, eventId), select: { id: true } });
  if (!cur) return { error: "Этап не найден" };
  if (!hasFile(fd)) return { error: "Выберите файл" };
  const f = await readEventFile(fd);
  if (!f || "error" in f) return { error: f?.error ?? "Выберите файл" };
  await attachFile(orgId, cur.id, f.file, str(fd, "title"));
  revalidateAll(orgId);
  return { ok: true };
}

export async function removeEventDocument(docId: string): Promise<{ error?: string }> {
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({ where: { id: docId, organizationId: orgId, shipmentEventId: { not: null }, ...(isSupplier(session) ? { shipmentEvent: { createdById: session.user.id, shipment: shipmentScope(session) } } : {}) }, select: { id: true, storagePath: true } });
  if (!doc) return { error: "Документ не найден" };
  await prisma.driveDocument.delete({ where: { id: doc.id } });
  await removeDriveFileIfUnused(doc.storagePath);
  revalidateAll(orgId);
  return {};
}

/** «+ Этап». Файл (необязательно) прикрепляется в той же отправке: сначала проверяется, потом этап создаётся. При заполненном «Следующий этап» создаётся ожидаемый этап. */
export async function createEvent(shipmentId: string, _prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  if (!(await ownShipment(session, shipmentId))) return { error: "Отгрузка не найдена" };
  const e = await parseEvent(session, fd);
  if (typeof e === "string") return { error: e };
  const file = await readEventFile(fd);
  if (file && "error" in file) return { error: file.error };
  const nextTitle = str(fd, "nextTitle");
  const nextDate = str(fd, "nextDate");
  const nextTime = str(fd, "nextTime");
  const nextSide = isSupplier(session) ? "WELLMEKH" : str(fd, "nextSide") || e.side;
  const nextWho = await resolveResponsible(orgId, str(fd, "nextResponsible"));
  if (nextTitle) {
    const ns = sideError(nextSide);
    if (ns) return { error: ns };
    const nb = supplierTitleError(session, nextTitle, null);
    if (nb) return { error: nb };
    if (nextTitle.length > 120) return { error: "Название следующего этапа не длиннее 120 символов" };
    if (!dateOk(nextDate)) return { error: "Укажите ожидаемую дату следующего этапа" };
    if (nextTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(nextTime)) return { error: "Время следующего этапа — ЧЧ:ММ или пусто" };
  }
  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.shipmentEvent.create({ data: { shipmentId, ...e, createdById: session.user.id } });
    if (nextTitle) {
      await tx.shipmentEvent.create({
        data: { shipmentId, title: nextTitle, occurredAt: wallToDate(nextDate, nextTime), timeKnown: Boolean(nextTime), expected: true, side: nextSide, ...nextWho, createdById: session.user.id },
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
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: eventWhere(session, eventId), select: { id: true } });
  if (!cur) return { error: "Этап не найден" };
  const e = await parseEvent(session, fd);
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
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({
    where: eventWhere(session, eventId),
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
  const session = await requireRole(...EVENT_ROLES);
  const orgId = session.user.organizationId;
  const cur = await prisma.shipmentEvent.findFirst({ where: eventWhere(session, eventId), select: { id: true, expected: true } });
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
    data: { shipmentId, title: ACCEPTANCE_TITLE, occurredAt: sh.plannedDate, timeKnown: false, expected: true, place: "Коптево", side: "CUM", createdById: session.user.id },
  });
  revalidateAll(orgId);
  return {};
}
