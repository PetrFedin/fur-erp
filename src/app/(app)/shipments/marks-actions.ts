"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { wallNow } from "@/lib/shipment-calc";
import { MARKS_TITLE, marksSummary, type MarkKind } from "@/lib/shipment-marks";
import { acceptLinesByReview, sendLineToRework } from "./actions";

type R = { error?: string; ok?: boolean; saved?: number };
export type MarkInput = { lineId: string; kind: MarkKind | ""; note: string };

/** Веллмех сохраняет отметки по строкам примерки своей отгрузки (все строки разом). Учёт ЦУМ не меняется. */
export async function saveSupplierMarks(shipmentId: string, marks: MarkInput[]): Promise<R> {
  const s = await requireRole("SUPPLIER");
  if (!s.user.supplierId) return { error: "Кабинет не привязан к поставщику" };
  if (!Array.isArray(marks) || marks.length > 500) return { error: "Слишком много строк" };
  const ship = await prisma.shipment.findFirst({ where: { id: shipmentId, organizationId: s.user.organizationId, supplierId: s.user.supplierId }, select: { id: true, lines: { select: { id: true, quantity: true } } } });
  if (!ship) return { error: "Отгрузка не найдена" };
  const byId = new Map(ship.lines.map((l) => [l.id, l]));
  const clean: { lineId: string; kind: MarkKind; note: string; qty: number }[] = [];
  for (const m of marks) {
    if (!m.kind) continue;
    const line = byId.get(m.lineId);
    if (!line) return { error: "Строка не найдена — обновите страницу" };
    if (m.kind !== "ok" && m.kind !== "no" && m.kind !== "remark") return { error: "Неизвестная отметка" };
    const note = String(m.note ?? "").trim().slice(0, 500);
    if (m.kind !== "ok" && !note) return { error: "К отметке «не принято» и «замечание» напишите, что не так" };
    clean.push({ lineId: m.lineId, kind: m.kind, note, qty: line.quantity });
  }
  const details = clean.length ? marksSummary(clean) : "отметок нет";
  await prisma.$transaction(async (tx) => {
    const ev = await tx.shipmentEvent.findFirst({ where: { shipmentId, title: MARKS_TITLE }, select: { id: true } });
    const data = { occurredAt: wallNow(), timeKnown: true, side: "WELLMEKH", responsibleName: "Веллмех", details, expected: false, updatedById: s.user.id };
    const id = ev
      ? (await tx.shipmentEvent.update({ where: { id: ev.id }, data })).id
      : (await tx.shipmentEvent.create({ data: { ...data, shipmentId, title: MARKS_TITLE, createdById: s.user.id } })).id;
    await tx.shipmentEventLine.deleteMany({ where: { eventId: id } });
    for (const m of clean) await tx.shipmentEventLine.create({ data: { eventId: id, shipmentLineId: m.lineId, qty: m.qty, accepted: m.kind === "ok" ? m.qty : null, rejected: m.kind === "no" ? m.qty : null, comment: m.note || null } });
  });
  revalidateAll(s.user.organizationId);
  return { ok: true, saved: clean.length };
}

/** «Подтвердить» у нас: принято → «Готов к отгрузке»; не принято / замечание → «На доработку» с текстом Веллмеха. */
export async function confirmSupplierMark(shipmentId: string, lineId: string): Promise<R> {
  const s = await requireRole("OWNER", "ADMIN", "TECHNOLOGIST");
  const ev = await prisma.shipmentEventLine.findFirst({ where: { shipmentLineId: lineId, event: { shipmentId, title: MARKS_TITLE, shipment: { organizationId: s.user.organizationId } } } });
  if (!ev) return { error: "Отметка Веллмеха не найдена" };
  if ((ev.accepted ?? 0) > 0) {
    const r = await acceptLinesByReview(shipmentId, [lineId]);
    return r.error ? { error: r.error } : { ok: true };
  }
  const r = await sendLineToRework(lineId, [{ text: `Веллмех: ${ev.comment ?? "замечание"}`, state: "OPEN", note: "" }] as never);
  return r.error ? { error: r.error } : { ok: true };
}
