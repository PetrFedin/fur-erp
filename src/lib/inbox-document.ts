import "server-only";
import { prisma } from "@/lib/prisma";
import { readStoredFile, removeStoredFiles } from "@/lib/fitting-files";
import { detectDocument, writeDocumentFiles, truncateFileName } from "@/lib/purchase-files";
import { SUPPLIER_DOC_TYPES, type DocumentPayload } from "@/lib/supplier-docs";
import { invalidateControlCounts } from "@/lib/control-counts";

export type DocAcceptResult = { ok: true; already?: boolean; type: "Purchase"; ids: string[]; message: string } | { ok?: false; error: string };

/** «Принять» входящее-документ: файлы копируются в документы закупки (PurchaseDocument), вход помечается принятым. Повтор ничего не дублирует. */
export async function acceptDocumentInbox(s: { user: { id: string; organizationId: string } }, id: string): Promise<DocAcceptResult> {
  const orgId = s.user.organizationId;
  const row = await prisma.supplierInbox.findFirst({ where: { id, organizationId: orgId, kind: "DOCUMENT" }, include: { files: true } });
  if (!row) return { error: "Входящее не найдено" };
  const p = row.payload as unknown as DocumentPayload;
  if (row.status === "ACCEPTED" && row.createdEntityId) return { ok: true, already: true, type: "Purchase", ids: [row.createdEntityId], message: "Уже принято" };
  if (row.status !== "SENT") return { error: "Это входящее уже обработано (принято или отклонено) — обновите страницу." };
  const type = SUPPLIER_DOC_TYPES.find((t) => t.key === p?.docType);
  if (!p || !type || !p.purchaseId) return { error: "Не удалось прочитать данные документа" };
  const purchase = await prisma.purchase.findFirst({ where: { id: p.purchaseId, organizationId: orgId, supplierId: row.supplierId }, select: { id: true } });
  if (!purchase) return { error: "Закупка не найдена" };
  // Лот: по id из документа; если его нет или он не связан с закупкой — по номеру лота внутри этой закупки, но только когда он один.
  // Неоднозначно или не найден — документ ложится на закупку.
  const ofPurchase = { OR: [{ purchaseId: purchase.id }, { purchaseItems: { some: { purchaseId: purchase.id } } }] };
  let lot = p.lotId ? await prisma.rawMaterialLot.findFirst({ where: { id: p.lotId, organizationId: orgId, ...ofPurchase }, select: { id: true } }) : null;
  const wantNo = (p.lotNumber ?? "").trim();
  if (!lot && wantNo) {
    const byNo = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, lotNumber: { equals: wantNo, mode: "insensitive" }, ...ofPurchase }, select: { id: true }, take: 2 });
    if (byNo.length === 1) lot = byNo[0];
  }
  if (row.files.length === 0) return { error: "У входящего нет файлов" };

  const ru = p.date ? p.date.split("-").reverse().join(".") : "";
  const title = `${type.label}${p.number ? ` № ${p.number}` : ""}${ru ? ` от ${ru}` : ""} (Веллмех)`;
  const docs = [];
  for (const f of row.files) {
    const buf = await readStoredFile(f.storagePath);
    if (!buf || buf.length === 0) return { error: `Файл «${f.originalName}» не найден на диске` };
    const kind = detectDocument(buf.subarray(0, 16), f.originalName, buf);
    if (!kind) return { error: `Файл «${f.originalName}» не подходит по формату` };
    docs.push({ buf, kind, originalName: truncateFileName(f.originalName, 200) });
  }
  const stored = await writeDocumentFiles(orgId, purchase.id, docs);
  const created: string[] = [];
  try {
    const ok = await prisma.$transaction(async (tx) => {
      const claim = await tx.supplierInbox.updateMany({
        where: { id, organizationId: orgId, status: "SENT" },
        data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: s.user.id, createdEntityType: "Purchase", createdEntityId: purchase.id },
      });
      if (claim.count !== 1) return false;
      for (const d of stored) {
        const doc = await tx.purchaseDocument.create({
          data: { organizationId: orgId, purchaseId: purchase.id, lotId: lot?.id ?? null, kind: type.purchase as never, title: p.comment ? `${title} — ${p.comment}`.slice(0, 200) : title, ...d },
          select: { id: true },
        });
        created.push(doc.id);
      }
      return true;
    });
    if (!ok) {
      await removeStoredFiles(stored.map((d) => d.storagePath));
      return { error: "Это входящее уже обработано (принято или отклонено) — обновите страницу." };
    }
  } catch (e) {
    await removeStoredFiles(stored.map((d) => d.storagePath));
    throw e;
  }
  invalidateControlCounts(orgId);
  const where = lot ? "лоту" + (wantNo ? ` ${wantNo}` : "") : "закупке";
  return { ok: true, type: "Purchase", ids: [purchase.id], message: `Документ прикреплён к ${where} (файлов: ${stored.length})` };
}
