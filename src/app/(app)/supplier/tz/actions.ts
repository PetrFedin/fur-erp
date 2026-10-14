"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession, inboxScope } from "@/lib/supplier-inbox";
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
    await prisma.supplierInbox.update({ where: { id }, data });
    revalidatePath("/supplier/tz");
    return { ok: true, id };
  }
  const row = await prisma.supplierInbox.create({
    data: { ...data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id, kind: "TZ", status: "DRAFT" },
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
  const r = await prisma.supplierInbox.updateMany({ where: { id, kind: "TZ", status: "DRAFT", ...inboxScope(s) }, data: { status: "SENT", sentAt: new Date() } });
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
