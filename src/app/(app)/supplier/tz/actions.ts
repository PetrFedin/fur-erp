"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession, inboxScope, actingNote } from "@/lib/supplier-inbox";
import { tzProblems, tzTotals, plainNum, type TzPayload } from "@/lib/tz-vendor";

type R = { error?: string; ok?: boolean; id?: string };

function parse(json: string): TzPayload | string {
  if (json.length > 1_000_000) return "Слишком большое ТЗ";
  try {
    const p = JSON.parse(json) as TzPayload;
    if (p?.v !== 1 || !Array.isArray(p.items) || !Array.isArray(p.materials) || !p.terms || !p.signers) return "Некорректные данные ТЗ";
    if (p.items.length > 300 || p.materials.length > 100) return "Слишком много строк";
    return p;
  } catch {
    return "Некорректные данные ТЗ";
  }
}
const titleOf = (p: TzPayload) => `ТЗ № ${p.number.trim() || "—"}${p.kind === "REPAIR" ? " (ремонт)" : ""}`.slice(0, 160);

export async function saveTzDraft(id: string | null, json: string): Promise<R> {
  const s = await requireSupplierSession();
  const p = parse(json);
  if (typeof p === "string") return { error: p };
  const t = tzTotals(p);
  const data = { title: titleOf(p), payload: { ...p, totals: { qty: t.qty, total: plainNum(t.total) } } as object };
  if (id) {
    const cur = await prisma.supplierInbox.findFirst({ where: { id, kind: "TZ", ...inboxScope(s) }, select: { status: true } });
    if (!cur) return { error: "ТЗ не найдено" };
    if (cur.status !== "DRAFT") return { error: "Отправленное ТЗ править нельзя" };
    // Правка только пока это черновик — и в самом запросе (если ТЗ успели отправить параллельно, оно не изменится).
    const upd = await prisma.supplierInbox.updateMany({ where: { id, kind: "TZ", status: "DRAFT", ...inboxScope(s) }, data: { ...data, ...(actingNote(s) ? { note: actingNote(s) } : {}) } });
    if (upd.count !== 1) return { error: "ТЗ уже отправлено — править нельзя" };
    revalidatePath("/supplier/tz");
    return { ok: true, id };
  }
  const row = await prisma.supplierInbox.create({
    data: { ...data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id, kind: "TZ", status: "DRAFT", note: actingNote(s) },
    select: { id: true },
  });
  revalidatePath("/supplier/tz");
  return { ok: true, id: row.id };
}

export async function sendTz(id: string, json: string): Promise<R> {
  const s = await requireSupplierSession();
  const p = parse(json);
  if (typeof p === "string") return { error: p };
  const problems = tzProblems(p);
  if (problems.length) return { error: problems.slice(0, 4).join("; ") };
  const saved = await saveTzDraft(id, json);
  if (saved.error) return saved;
  const r = await prisma.supplierInbox.updateMany({ where: { id, kind: "TZ", status: "DRAFT", ...inboxScope(s) }, data: { status: "SENT", sentAt: new Date(), ...(actingNote(s) ? { note: actingNote(s) } : {}) } });
  if (r.count !== 1) return { error: "Не удалось отправить: ТЗ уже отправлено или не найдено" };
  revalidatePath("/supplier/tz");
  return { ok: true, id };
}

export async function deleteTzDraft(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const r = await prisma.supplierInbox.deleteMany({ where: { id, kind: "TZ", status: "DRAFT", ...inboxScope(s) } });
  if (r.count !== 1) return { error: "Черновик не найден" };
  revalidatePath("/supplier/tz");
  return { ok: true };
}

/** «Вернуть в черновик и исправить»: отправленное, но ещё не принятое ТЗ снова становится черновиком; дата возврата видна у нас во «Входящих». Только свои ТЗ. */
export async function reopenSentTz(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const cur = await prisma.supplierInbox.findFirst({ where: { id, kind: "TZ", status: "SENT", ...inboxScope(s) }, select: { payload: true } });
  if (!cur) return { error: "ТЗ не найдено или уже принято/отклонено — исправьте его копией" };
  const payload = { ...(cur.payload as object), reopenedAt: new Date().toISOString() };
  const r = await prisma.supplierInbox.updateMany({ where: { id, kind: "TZ", status: "SENT", ...inboxScope(s) }, data: { status: "DRAFT", sentAt: null, payload: payload as object } });
  if (r.count !== 1) return { error: "ТЗ уже принято или отклонено — исправьте его копией" };
  revalidatePath("/supplier/tz");
  revalidatePath(`/supplier/tz/${id}`);
  return { ok: true, id };
}

/** «Исправить и отправить заново» для принятого/отклонённого ТЗ: новый черновик с теми же данными, исходное остаётся как есть. Только свои ТЗ. */
export async function copyTzAsDraft(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const cur = await prisma.supplierInbox.findFirst({ where: { id, kind: "TZ", status: { in: ["ACCEPTED", "REJECTED"] }, ...inboxScope(s) }, select: { payload: true, title: true } });
  if (!cur) return { error: "ТЗ не найдено" };
  const { totals: _t, reopenedAt: _r, ...rest } = cur.payload as Record<string, unknown>;
  void _t; void _r;
  const row = await prisma.supplierInbox.create({
    data: { organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id, kind: "TZ", status: "DRAFT", note: actingNote(s), title: `${cur.title} (исправленное)`.slice(0, 160), payload: rest as object },
    select: { id: true },
  });
  revalidatePath("/supplier/tz");
  return { ok: true, id: row.id };
}
