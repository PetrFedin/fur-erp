import { createHash } from "node:crypto";

/**
 * Лёгкая оптимистичная защита от «последний затирает первого».
 * Форма правки получает «версию» записи (хэш редактируемых полей на момент открытия) в скрытом поле `_v`.
 * Server action пересчитывает версию по текущей записи в базе: если она не совпала — запись успел изменить
 * кто-то другой, и вместо тихой перезаписи возвращается понятная ошибка. Поле необязательное: скрипты и e2e,
 * которые его не шлют, работают как раньше.
 * Версия считается по самим полям, а не по updatedAt: так не бывает ложных конфликтов от побочных обновлений
 * (подтверждение, пересчёт) и защита работает и для записей без updatedAt (оплаты, позиции закупок).
 */
export const VERSION_FIELD = "_v";

export function rowVersion(row: Record<string, unknown>, fields: readonly string[]): string {
  const s = fields
    .map((f) => {
      const v = row[f];
      if (v == null) return "";
      if (v instanceof Date) return v.toISOString();
      return String(v);
    })
    .join("␟");
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
}

/**
 * null — можно сохранять; строка — текст ошибки для пользователя.
 * `changedAt` — updatedAt записи, если он есть (чтобы назвать время чужой правки).
 */
export function staleError(formData: FormData, current: Record<string, unknown>, fields: readonly string[], changedAt?: Date | null): string | null {
  const sent = formData.get(VERSION_FIELD);
  if (typeof sent !== "string" || sent === "") return null;
  if (sent === rowVersion(current, fields)) return null;
  const when = changedAt ? ` в ${hhmm(changedAt)}` : "";
  return `Запись изменил другой пользователь${when} — ваши правки не сохранены. Обновите страницу (F5) и внесите правки заново.`;
}

/** Какие поля входят в «версию» каждой правимой записи (то, что реально меняет форма правки). */
export const AUCTION_V = ["name", "fullName", "house", "kind", "year", "month", "currency", "auctionDate", "isService", "confirmed", "note"] as const;
export const PURCHASE_V = ["supplierId", "warehouseId", "currency", "auctionSession", "invoiceNumber", "invoiceDate", "transferDocument", "orderDate", "notes"] as const;
export const PURCHASE_ITEM_V = ["rawMaterialId", "quantity", "unitPrice", "vatRate", "lotNumber", "grade", "color"] as const;
export const ORDER_V = [
  "productModelId", "rawWarehouseId", "finishedWarehouseId", "plannedQuantity", "color", "size", "materialDescription",
  "lining", "startDate", "notes", "clientId", "batchId", "contractNumber", "workOrderNumber", "workOrderDate", "clientWorkPricePerUnit",
] as const;
export const MODEL_V = ["name", "sku", "category", "sellingPrice", "description"] as const;
export const PAYMENT_V = ["supplierId", "amount", "method", "paidAt", "notes", "status", "kind", "percent"] as const;
export const PURCHASE_EXPENSE_V = ["categoryId", "amount", "vatRate", "description"] as const;
export const PAYMENT_EDIT_V = ["purchaseId", "amount", "method", "paidAt", "notes", "status", "docRef"] as const;
/** Карточка оплаты /payments/[id]: все поля, которые она правит (оплата поставщику и оплата за работу). */
export const PAYMENT_CARD_V = ["purchaseId", "auctionSession", "amount", "method", "paidAt", "notes", "docRef", "invoiceNo", "ppNo"] as const;
export const PRODUCTION_CARD_V = ["amount", "method", "paidAt", "notes", "docRef", "invoiceNo", "ppNo"] as const;
export const LOT_V = ["lotNumber", "grade", "sizeGrade", "color", "colorRefId", "notes"] as const;
export const PRODUCTION_PAYMENT_V = ["clientId", "amount", "paymentType", "method", "paidAt", "notes", "docRef"] as const;
export const BATCH_V = ["number", "name", "year", "plannedUnits", "notes"] as const;
export const DRIVE_DOC_V = ["title", "docType", "docNumber", "docDate", "year", "notes"] as const;
