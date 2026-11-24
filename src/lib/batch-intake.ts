// Модуль разнесён по частям в _batch-intake/; здесь — прежний путь импорта.
export { BASIC_FIELDS, CALC_FIELDS, ALL_FIELDS, FIELD_LABEL, DEFAULT_ORDER, num, detectColumns, EMPTY_ROW, applyMapping, parsePasteTable, validateRows, itemsOf, percentColumns, DOC_KINDS, DOC_KIND_LABEL, AMOUNT_KINDS, parseRuDate, parseMoney, recognizeFromName } from "./_batch-intake/basic-fields";
export type { FieldKey, Mapping, Detected, FurOption, IntakeContext, ItemDraft } from "./_batch-intake/basic-fields";
export type { IntakeRow, FurDecision, ColorDecision, Decisions, RowCheck, UnknownRef, ValidationResult, DocKindKey, DocFind, Recon, BatchHeader, DocMeta, BatchPayload, PurchaseTotals, DocRecon, BatchPreview, BatchResult } from "./_batch-intake/shared";
export { recognizeFromText, DOC_TOLERANCE_RUB, reconcileAmount, DEFAULT_VAT_RATE, serviceVatPctFor } from "./_batch-intake/recognize-from-text";
export type { ReconTotals } from "./_batch-intake/recognize-from-text";
export { roundRate } from "@/lib/cost-plan";
