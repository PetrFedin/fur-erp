"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import { parseDateInput } from "@/lib/input";
import { createAuctionTx, resolveAuctionIn } from "@/lib/auction-ref";
import { resolveVatRate } from "@/lib/vat-by-date";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { syncPurchaseInvoice } from "@/lib/invoice-sync";
import { AMOUNT_TOO_BIG, tooBig, EDIT_ROLES } from "./shared";
import { receivePurchase } from "./purchase-header";

export type LiningBatchState = { error?: string; ok?: string; purchaseId?: string };

type LiningLineInput = { materialId?: string; newNumber?: string; meters?: string | number; price?: string | number; vat?: string | number | null };

/**
 * «Купить подкладку»: одна закупка партии подкладки с несколькими тканями (дата, поставщик, название партии, счёт, строки «ткань · метры · цена · НДС»).
 * Создаёт закупку и позиции (курс 1, склад по умолчанию) и сразу принимает её (receivePurchase): метры попадают в пул ткани, видны в таблице подкладки,
 * плитках и Главной, в «Закупках», «Оплатах» (долг) и в выборе ткани в ТЗ. Цена на форме — с НДС или без (priceMode); в базе цена за метр хранится без НДС.
 */
export async function createLiningBatchPurchase(_prev: LiningBatchState, formData: FormData): Promise<LiningBatchState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const orderDate = parseDateInput(String(formData.get("date") ?? ""));
  if (!orderDate) return { error: "Укажите дату закупки" };
  // Закупка принимается на склад сразу, поэтому дата в будущем невозможна (и выпала бы из таблиц по годам). Запас в сутки — на часовые пояса.
  if (orderDate.getTime() > Date.now() + 24 * 3600 * 1000) return { error: "Дата закупки не может быть в будущем — закупка принимается на склад сразу" };
  const supplierId = String(formData.get("supplierId") ?? "");
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: orgId }, select: { id: true } });
  if (!supplier) return { error: "Выберите поставщика" };
  const mm = String(orderDate.getUTCMonth() + 1).padStart(2, "0");
  const batchName = (String(formData.get("batchName") ?? "").trim() || `Подкладка ${mm}.${String(orderDate.getUTCFullYear()).slice(2)}`).slice(0, 120);
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim().slice(0, 60) || undefined;
  const invoiceDateRaw = String(formData.get("invoiceDate") ?? "").trim();
  const invoiceDate = invoiceDateRaw ? parseDateInput(invoiceDateRaw) : null;
  if (invoiceDateRaw && !invoiceDate) return { error: "Укажите корректную дату счёта" };
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || undefined;
  const priceIncl = String(formData.get("priceMode") ?? "excl") === "incl";

  let lines: LiningLineInput[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { error: "Не удалось прочитать строки закупки" };
  }
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) return { error: "Добавьте хотя бы одну ткань" };

  const defaultWarehouseId = await getDefaultWarehouseId(orgId);
  if (!defaultWarehouseId) return { error: "Не удалось определить место прихода: оформите закупку через раздел «Закупки»" };

  type Prepared = { materialId: string | null; materialName: string; meters: Decimal; unitExcl: Decimal; vat: number };
  const prepared: Prepared[] = [];
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    const meters = new Decimal(String(l.meters ?? "").replace(",", ".") || "0");
    const price = new Decimal(String(l.price ?? "").replace(",", ".") || "-1");
    if (!meters.isFinite() || meters.lte(0)) return { error: `Строка ${n}: укажите метры` };
    if (!price.isFinite() || price.lt(0)) return { error: `Строка ${n}: укажите цену за метр` };
    let materialId: string | null = null;
    let materialName = "";
    let defaultVat: string | null = null;
    if (l.materialId && l.materialId !== "__new") {
      const m = await prisma.rawMaterial.findFirst({ where: { id: l.materialId, organizationId: orgId, unit: "M" }, select: { id: true, name: true, defaultVatRate: true } });
      if (!m) return { error: `Строка ${n}: ткань не найдена` };
      materialId = m.id; materialName = m.name; defaultVat = m.defaultVatRate?.toString() ?? null;
    } else {
      const num = String(l.newNumber ?? "").replace(/^№\s*/, "").trim();
      if (!num) return { error: `Строка ${n}: выберите ткань или укажите номер новой` };
      if (!/^[0-9A-Za-zА-Яа-я\-\/.]{1,20}$/.test(num)) return { error: `Строка ${n}: номер ткани — до 20 символов, без пробелов` };
      materialName = `Подкладочная ткань №${num}`;
      const m = await prisma.rawMaterial.findFirst({ where: { organizationId: orgId, unit: "M", name: { equals: materialName, mode: "insensitive" } }, select: { id: true, defaultVatRate: true } });
      if (m) { materialId = m.id; defaultVat = m.defaultVatRate?.toString() ?? null; }
    }
    // Докупка идёт в единый пул ткани (addOrPoolLiningLot): если лотов у ткани уже несколько, приёмка откажет — говорим об этом сразу и понятно, до создания закупки.
    if (materialId) {
      const lotCount = await prisma.rawMaterialLot.count({ where: { organizationId: orgId, rawMaterialId: materialId } });
      if (lotCount > 1) return { error: `Строка ${n}: у «${materialName}» ${lotCount} лота — докупать через форму можно только ткань с одним лотом. Лоты ткани нужно сначала объединить в один — обратитесь к разработчику.` };
    }
    const vatRaw = String(l.vat ?? "").replace(",", ".").trim();
    const vat = vatRaw === "" ? resolveVatRate(defaultVat, orderDate).rate : Number(vatRaw);
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) return { error: `Строка ${n}: НДС от 0 до 100%` };
    const unitExcl = (priceIncl ? price.div(new Decimal(1).add(new Decimal(vat).div(100))) : price).toDecimalPlaces(2);
    if (tooBig(meters.mul(unitExcl))) return { error: `Строка ${n}: ${AMOUNT_TOO_BIG}` };
    prepared.push({ materialId, materialName, meters, unitExcl, vat });
  }

  let purchaseId: string | null = null;
  let createdAuctionId: string | null = null;
  const createdMaterials: string[] = [];
  try {
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, "purchase", orgId, "З");
      // Партия -> аукцион справочника (kind «Подкладка»): найденный по имени/написанию или новый. Без ссылки самопроверка ругается «записан текстом».
      const found = await resolveAuctionIn(tx, batchName, orgId);
      let auctionId: string | null = null;
      let auctionText = batchName;
      if (found && !found.isService) {
        auctionId = found.id; auctionText = found.name;
      } else if (!found) {
        const a = await createAuctionTx(tx, orgId, {
          name: batchName, kind: "LINING", currency: "RUB", year: orderDate.getUTCFullYear(), month: orderDate.getUTCMonth() + 1,
        });
        auctionId = a.id; createdAuctionId = a.id;
      }
      const purchase = await tx.purchase.create({
        data: {
          organizationId: orgId, number, supplierId: supplier.id, warehouseId: defaultWarehouseId, currency: "RUB", exchangeRate: 1,
          auctionSession: auctionText, auctionId, invoiceNumber, invoiceDate: invoiceDate ?? undefined, orderDate, notes, createdById: session.user.id,
        },
      });
      await syncPurchaseInvoice(tx, purchase.id, { setDate: true });
      const idByName = new Map<string, string>();
      for (const p of prepared) {
        let mid = p.materialId ?? idByName.get(p.materialName.toLowerCase()) ?? null;
        if (!mid) {
          const m = await tx.rawMaterial.create({ data: { organizationId: orgId, name: p.materialName, unit: "M" }, select: { id: true } });
          mid = m.id; createdMaterials.push(m.id); idByName.set(p.materialName.toLowerCase(), m.id);
        }
        await tx.purchaseItem.create({
          data: { purchaseId: purchase.id, rawMaterialId: mid, quantity: p.meters, unitPrice: p.unitExcl, subtotal: p.meters.mul(p.unitExcl), vatRate: p.vat },
        });
      }
      return purchase;
    });
    purchaseId = created.id;
    const res = await receivePurchase(created.id);
    if (res.error) throw new Error(res.error);
  } catch (e) {
    // Откат: если приёмка не удалась, чернового документа и только что созданных тканей не оставляем.
    try {
      if (purchaseId) {
        const p = await prisma.purchase.findUnique({ where: { id: purchaseId }, select: { status: true } });
        if (p && p.status !== "RECEIVED") await prisma.purchase.delete({ where: { id: purchaseId } });
      }
      for (const mid of createdMaterials) {
        const [items, lots] = await Promise.all([prisma.purchaseItem.count({ where: { rawMaterialId: mid } }), prisma.rawMaterialLot.count({ where: { rawMaterialId: mid } })]);
        if (items === 0 && lots === 0) await prisma.rawMaterial.delete({ where: { id: mid } });
      }
      if (createdAuctionId) await prisma.auction.deleteMany({ where: { id: createdAuctionId, organizationId: orgId, purchases: { none: {} } } });
    } catch {
      /* best effort */
    }
    return { error: `Закупка не оформлена: ${e instanceof Error ? e.message : "неизвестная ошибка"}` };
  }

  revalidateAll(orgId);
  const total = prepared.reduce((a, p) => a.add(p.meters), new Decimal(0));
  return { ok: `Закупка оформлена: ${batchName}, ${prepared.length} ткан., ${total.toString().replace(".", ",")} м`, purchaseId: purchaseId ?? undefined };
}
