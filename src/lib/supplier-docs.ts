// Типы документов, которые Веллмех прикладывает к закупке или лоту (сохраняются как входящее вида DOCUMENT).
export const SUPPLIER_DOC_TYPES = [
  { key: "UPD", label: "УПД", inbox: "UPD", purchase: "UPD" },
  { key: "SPECIFICATION", label: "Спецификация", inbox: "SPECIFICATION", purchase: "SPECIFICATION" },
  { key: "INVOICE", label: "Счёт", inbox: "PAYMENT_INVOICE", purchase: "OTHER" },
  { key: "LETTER", label: "Письмо", inbox: "OTHER", purchase: "OTHER" },
] as const;
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
