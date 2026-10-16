"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession, actingNote } from "@/lib/supplier-inbox";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { invalidateControlCounts } from "@/lib/control-counts";
import { SUPPLIER_DOC_TYPES, supplierMayUpload, type DocumentPayload } from "@/lib/supplier-docs";

export type AttachState = { error?: string; ok?: boolean };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** «Приложить документ» к закупке или лоту: сразу уходит к нам во «Входящие» (тип «Документ»), там его принимают или отклоняют. */
export async function attachDocument(_prev: AttachState, formData: FormData): Promise<AttachState> {
  const s = await requireSupplierSession();
  const purchaseId = clip(formData.get("purchaseId"), 64);
  const itemId = clip(formData.get("itemId"), 64);
  // Документы по оплате загружает только заказчик: от подрядчика платёжные типы и любые неизвестные отклоняются на сервере.
  const docTypeRaw = formData.get("docType");
  if (typeof docTypeRaw === "string" && !supplierMayUpload(docTypeRaw) && /PAYMENT|ОПЛАТ/i.test(docTypeRaw)) return { error: "Документы по оплате загружает заказчик" };
  const type = SUPPLIER_DOC_TYPES.find((t) => supplierMayUpload(t.key) && t.key === docTypeRaw);
  if (!ID.test(purchaseId) || !type) return { error: "Проверьте форму" };
  const date = clip(formData.get("date"), 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Дата — в формате ГГГГ-ММ-ДД" };
  // Закупка — только этого поставщика и этой организации.
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: s.user.organizationId, supplierId: s.user.supplierId },
    select: { id: true, number: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  let lotId: string | null = null;
  let lotNumber: string | null = null;
  if (itemId) {
    if (!ID.test(itemId)) return { error: "Проверьте форму" };
    const item = await prisma.purchaseItem.findFirst({ where: { id: itemId, purchaseId: purchase.id }, select: { lotId: true, lotNumber: true } });
    if (!item) return { error: "Лот не найден" };
    lotId = item.lotId;
    lotNumber = item.lotNumber;
  }
  const read = await readDocumentFiles(formData.getAll("files"));
  if ("error" in read) return { error: read.error };

  const number = clip(formData.get("number"), 60);
  const payload: DocumentPayload = { purchaseId: purchase.id, purchaseNumber: purchase.number, lotId, lotNumber, docType: type.key, number, date, comment: clip(formData.get("comment"), 1000) };
  const title = `${type.label}${number ? ` № ${number}` : ""} · ${purchase.number}${lotNumber ? ` · лот ${lotNumber}` : ""}`;
  const id = (await prisma.supplierInbox.create({
    data: {
      organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id,
      kind: "DOCUMENT", status: "SENT", sentAt: new Date(), title, payload: payload as never, note: actingNote(s),
    },
    select: { id: true },
  })).id;
  const stored = await writeDocumentFiles(s.user.organizationId, `supplier-inbox/${id}`, read.files);
  try {
    await prisma.supplierInboxFile.createMany({ data: stored.map((d) => ({ inboxId: id, ...d, kind: type.inbox as never })) });
  } catch (e) {
    await removeStoredFiles(stored.map((d) => d.storagePath));
    await prisma.supplierInbox.delete({ where: { id } });
    throw e;
  }
  invalidateControlCounts(s.user.organizationId);
  revalidatePath("/supplier/raw");
  revalidatePath("/inbox");
  return { ok: true };
}
