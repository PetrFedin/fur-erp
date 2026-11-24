"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { acceptSummaryText, sideError, shipmentTotals, wallNow, wallToDate } from "@/lib/shipment-calc";
import { loadShipmentCandidates } from "@/lib/shipment-data";
import { clip, eventTitles, isReworkState, moveError, REWORK_STATE_LABEL } from "@/lib/shipment-stage";
import { orderLabel } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { EDIT_ROLES, type EditResult, str, dateOk, resolveResponsible, ownShipment } from "./shared";

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
  const sideErr = sideError(side);
  if (sideErr) return { error: sideErr };
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
      data: { expected: false, occurredAt: at, timeKnown: Boolean(time), side, ...who, details, updatedById: session.user.id },
    });
    await tx.shipment.update({ where: { id: shipmentId }, data: { acceptedAt: at, acceptedBy: who.responsibleName, acceptEventId: ev.id, status: "ACCEPTED" } });
  });
  revalidateAll(orgId);
  return { ok: true };
}

/** «Отменить приёмку»: этап снова ожидаемый, acceptedAt снимается, статус — «Запланирована». */
export async function cancelAcceptance(shipmentId: string): Promise<{ error?: string }> {
  const session = await requireRole("OWNER", "ADMIN");
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
  if (!(await ownShipment(session, shipmentId))) return [];
  return loadShipmentCandidates(orgId, shipmentId);
}

// ───────────── стадии строк: просмотр → доработка → готов к отгрузке ─────────────

export type ReworkInput = { id?: string; text: string; state: string; note: string };

type StageResult = { error?: string; ok?: boolean; changed?: number };

const lineSel = {
  id: true, shipmentId: true, stage: true, itemNo: true, size: true, color: true, acceptedQty: true, returnedQty: true, productionOrderId: true, customArticle: true,
  productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModel: { select: { name: true } } } },
  reworks: { select: { id: true, state: true, text: true } },
} as const;

/** «M018 р. 44 №259» — короткое имя строки для названий этапов. */
function articleOf(l: { size: string | null; itemNo: string | null; customArticle: string | null; productionOrder: { productModel: { name: string } } | null }): string {
  return [l.productionOrder?.productModel.name ?? l.customArticle ?? "–", l.size ? `р. ${l.size}` : "", l.itemNo ? `№${l.itemNo}` : ""].filter(Boolean).join(" ");
}

async function lineDetails(orgId: string, lines: { id: string; size: string | null; itemNo: string | null; customArticle: string | null; productionOrder: { id: string; number: string; workOrderNumber: string | null; productModel: { name: string } } | null }[]): Promise<string> {
  const pos = await loadTzPositions(orgId, lines.flatMap((l) => (l.productionOrder ? [l.productionOrder] : [])));
  return lines.map((l) => `${l.productionOrder ? orderLabel({ workOrderNumber: l.productionOrder.workOrderNumber, number: l.productionOrder.number, ...pos.get(l.productionOrder.id) }) : "без ТЗ"} · ${articleOf(l)}`).join("\n").slice(0, 3900);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Автоэтап хронологии: «сейчас», время известно, ответственный — нажавший кнопку, «на ком» — ЦУМ. */
async function stageEvent(tx: Tx, shipmentId: string, userId: string, title: string, details: string | null) {
  await tx.shipmentEvent.create({ data: { shipmentId, title, occurredAt: wallNow(), timeKnown: true, responsibleUserId: userId, details, side: "CUM", createdById: userId } });
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
  if (!(await ownShipment(session, shipmentId))) return { error: "Отгрузка не найдена" };
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
