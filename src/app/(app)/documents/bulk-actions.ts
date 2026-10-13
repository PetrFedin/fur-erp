"use server";

import { batchNameText } from "@/lib/batch-name";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { readOneDriveFile } from "@/lib/drive-files";
import { extractDocText } from "@/lib/doc-content-text";
import { uploadDriveDocument, type DriveDocState } from "@/app/(app)/drive-actions";
import { BULK_ENTITY_LABEL, decide, findTargets, isDuplicate, recognizeBulk, type BulkEntity, type BulkSuggestion, type BulkTarget } from "@/lib/bulk-doc-match";

/**
 * Массовая загрузка документов. Файлы идут по одному (клиент вызывает действия по очереди), поэтому ошибка одного
 * файла не срывает остальные. Запись — прежним uploadDriveDocument (те же проверки прав, файла и сброса подтверждения).
 */

const ENTITIES = Object.keys(BULK_ENTITY_LABEL) as BulkEntity[];
const ALLOWED: Record<BulkEntity, readonly string[]> = {
  purchase: ACCESS.purchases,
  lot: ACCESS.purchases,
  order: PRODUCTION_EDIT_ROLES,
  batch: PRODUCTION_EDIT_ROLES,
  payment: ["OWNER", "ADMIN"],
  productionPayment: ["OWNER", "ADMIN"],
};

export type BulkAnalysis = { error: string } | ({ ok: true; name: string; size: number } & BulkSuggestion);

/** Один файл → тип, номер, дата и предложенная привязка. Ничего не сохраняет. */
export async function analyzeBulkDocument(formData: FormData): Promise<BulkAnalysis> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const read = await readOneDriveFile(formData);
  if ("error" in read) return { error: read.error };
  const f = read.file;
  const text = await extractDocText(f.buf, f.kind.ext);
  const inp = { fileName: f.originalName, text };
  const rec = recognizeBulk(inp, f.kind.ext);
  const all = await findTargets(prisma, orgId, inp, rec);
  const candidates = all.filter((t) => hasRole(session.user.role, ALLOWED[t.entity]));
  const { target, note } = decide(candidates);
  const duplicate = target ? await isDuplicate(prisma, orgId, target, f.originalName, f.buf.length) : false;
  const textNote = !rec.textRead ? (f.kind.ext === "jpg" || f.kind.ext === "png" ? "Картинка: тип и номер определены по имени файла" : "Текст файла не прочитан: тип и номер — по имени файла") : null;
  return { ok: true, name: f.originalName, size: f.buf.length, ...rec, candidates, target, note: [note, textNote, duplicate ? "Такой файл уже загружен к этому объекту" : null].filter(Boolean).join(". ") || null, duplicate };
}

/** Поиск объекта для ручной привязки. */
export async function searchBulkTargets(entity: string, q: string): Promise<BulkTarget[]> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  if (!(ENTITIES as string[]).includes(entity)) return [];
  const e = entity as BulkEntity;
  if (!hasRole(session.user.role, ALLOWED[e])) return [];
  const s = q.trim().slice(0, 60);
  const ins = s ? { contains: s, mode: "insensitive" as const } : undefined;
  const ru = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
  const rub = (n: { toString(): string }) => `${Number(n.toString()).toLocaleString("ru-RU")} ₽`;
  const why = "выбрано вручную";
  if (e === "purchase") {
    const rows = await prisma.purchase.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(ins ? { OR: [{ number: ins }, { invoiceNumber: ins }, { transferDocument: ins }, { supplier: { name: ins } }] } : {}) },
      orderBy: { orderDate: "desc" }, take: 15, select: { id: true, number: true, orderDate: true, invoiceNumber: true, supplier: { select: { name: true } } },
    });
    return rows.map((p) => ({ entity: e, id: p.id, label: `${p.number} · ${p.supplier.name} · ${ru(p.orderDate)}${p.invoiceNumber ? ` · счёт ${p.invoiceNumber}` : ""}`, why }));
  }
  if (e === "payment") {
    const rows = await prisma.payment.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(ins ? { OR: [{ docRef: ins }, { supplier: { name: ins } }, { notes: ins }] } : {}) },
      orderBy: { paidAt: "desc" }, take: 15, select: { id: true, paidAt: true, amount: true, docRef: true, supplier: { select: { name: true } } },
    });
    return rows.map((p) => ({ entity: e, id: p.id, label: `${p.supplier.name} · ${ru(p.paidAt)} · ${rub(p.amount)}${p.docRef ? ` · ${p.docRef}` : ""}`, why }));
  }
  if (e === "productionPayment") {
    const rows = await prisma.productionPayment.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(ins ? { OR: [{ docRef: ins }, { notes: ins }, { client: { name: ins } }] } : {}) },
      orderBy: { paidAt: "desc" }, take: 15, select: { id: true, paidAt: true, amount: true, docRef: true, client: { select: { name: true } } },
    });
    return rows.map((p) => ({ entity: e, id: p.id, label: `${p.client?.name ?? "оплата производства"} · ${ru(p.paidAt)} · ${rub(p.amount)}${p.docRef ? ` · ${p.docRef}` : ""}`, why }));
  }
  if (e === "order") {
    const rows = await prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(ins ? { OR: [{ number: ins }, { workOrderNumber: ins }, { client: { name: ins } }] } : {}) },
      orderBy: { createdAt: "desc" }, take: 15, select: { id: true, number: true, workOrderNumber: true, client: { select: { name: true } } },
    });
    return rows.map((o) => ({ entity: e, id: o.id, label: `ТЗ ${o.workOrderNumber ?? o.number}${o.client ? ` · ${o.client.name}` : ""}`, why }));
  }
  if (e === "batch") {
    const n = /^\d+$/.test(s) ? Number(s) : null;
    const rows = await prisma.productionBatch.findMany({
      where: { organizationId: orgId, ...(n !== null ? { number: n } : ins ? { name: ins } : {}) },
      orderBy: { number: "desc" }, take: 15, select: { id: true, number: true, name: true },
    });
    return rows.map((b) => ({ entity: e, id: b.id, label: `Партия ${b.number}${batchNameText(b.name) ? ` · ${batchNameText(b.name)}` : ""}`, why }));
  }
  const rows = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId, ...(ins ? { lotNumber: ins } : {}) },
    orderBy: { createdAt: "desc" }, take: 15, select: { id: true, lotNumber: true, purchase: { select: { number: true } } },
  });
  return rows.map((l) => ({ entity: e, id: l.id, label: `Лот ${l.lotNumber ?? "без номера"}${l.purchase ? ` · закупка ${l.purchase.number}` : ""}`, why }));
}

/** Один файл → документ с оригиналом, привязанный к объекту (поля формы: file, entity, entityId, docType, docNumber, docDate, title). */
export async function uploadBulkDocument(formData: FormData): Promise<DriveDocState> {
  const entity = String(formData.get("entity") ?? "");
  const id = String(formData.get("entityId") ?? "");
  if (!(ENTITIES as string[]).includes(entity) || !id) return { error: "Не выбрана привязка" };
  return uploadDriveDocument(entity as BulkEntity, id, formData);
}
