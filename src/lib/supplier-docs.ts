// Типы документов, которые Веллмех прикладывает к закупке или лоту (сохраняются как входящее вида DOCUMENT).
export const SUPPLIER_DOC_TYPES = [
  { key: "UPD", label: "УПД", inbox: "UPD", purchase: "UPD" },
  { key: "SPECIFICATION", label: "Спецификация", inbox: "SPECIFICATION", purchase: "SPECIFICATION" },
  { key: "INVOICE", label: "Счёт", inbox: "PAYMENT_INVOICE", purchase: "OTHER" },
  { key: "LETTER", label: "Письмо", inbox: "OTHER", purchase: "OTHER" },
  { key: "BUDGET", label: "Смета / бюджет", inbox: "OTHER", purchase: "OTHER" },
] as const;

/**
 * Документы по оплате (платёжки, п/п, подтверждения и запросы по оплате) загружает только заказчик.
 * Веллмех видит лишь факт «есть / нет». Старый ключ PAYMENT_NOTE остаётся в запретном списке: ранние записи и прямые запросы.
 */
export const SUPPLIER_FORBIDDEN_DOC_KEYS: readonly string[] = ["PAYMENT_NOTE", "PAYMENT_PROOF", "PAYMENT_ORDER", "PAYMENT"];

/** Можно ли подрядчику загрузить документ такого типа (по списку SUPPLIER_DOC_TYPES, платёжные — никогда). */
export function supplierMayUpload(key: unknown): key is SupplierDocKey {
  return typeof key === "string" && !SUPPLIER_FORBIDDEN_DOC_KEYS.includes(key) && SUPPLIER_DOC_TYPES.some((t) => t.key === key);
}
export type SupplierDocKey = (typeof SUPPLIER_DOC_TYPES)[number]["key"];

/** Содержимое payload входящего вида DOCUMENT. */
export type DocumentPayload = {
  purchaseId: string;
  purchaseNumber: string;
  lotId: string | null;
  lotNumber: string | null;
  docType: SupplierDocKey;
  number: string;
  date: string;
  comment: string;
};
