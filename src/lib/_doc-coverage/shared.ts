import "server-only";
import type { DriveDocTypeKey } from "@/lib/drive-docs";

/**
 * «Покрытие документами»: какие документы нужны каждой записи и каких не хватает.
 * Всё считается живыми запросами к базе, ничего не хранится.
 *
 * ПРАВИЛА («какие документы нужны») собраны в первой половине файла — в функциях
 * purchaseRules, tzRules, batchRules, paymentRules, contractRules. Хотите изменить требования — правьте только их. Вторая половина файла
 * — механика: загрузка из БД, дедупликация, подсчёт, фильтры.
 *
 * Источники документов — две таблицы сразу: DriveDocument.docType (документы ТЗ, партий, оплат)
 * и PurchaseDocument.kind (документы закупок). Считаются только документы с прикреплённым файлом.
 * Один и тот же документ, попавший в обе, считается один раз (по типу и названию / внутреннему ключу файла).
 * Отменённые закупки, ТЗ и оплаты не считаются.
 */

// ===================================================================== СТОЛБЦЫ

export type ColKey =
  | "AUCTION_INVOICE"
  | "UPD"
  | "CALC_SHEET"
  | "SPECIFICATION"
  | "PAYMENT"
  | "APPROVAL_EMAIL"
  | "TZ_APPENDIX"
  | "CONTRACT";

// ======================================================================= ПРАВИЛА
// need: "required" — нужен (нет — красная «нет»), "optional" — желателен (нет — серая,
// в пробелы не считается), "na" — не требуется.
// accepts — какие типы документов закрывают ячейку (по умолчанию — свои, см. COLUMNS.types).
// viaRef — ячейку закрывает и номер платёжки/счёта в поле «документ» (docRef) самой оплаты.
// label/attach — как назвать недостающее в списке (по умолчанию — подпись столбца).

export type Need = "required" | "optional" | "na";

export type CellRule = { need: Need; accepts?: DriveDocTypeKey[]; viaRef?: boolean; label?: string; attach?: string };

export type RowRules = Partial<Record<ColKey, CellRule>>;

// ======================================================================== ТИПЫ

export type SectionKey = "purchases" | "tz" | "batches" | "payments" | "prodPayments" | "contracts";

export type Cell = { need: Need; count: number; ok: boolean; viaRef: boolean };

export type Gap = { label: string; attach: string };

// ====================================================================== МЕХАНИКА

export type CovDoc = { type: DriveDocTypeKey; keys: string[]; original: boolean };
