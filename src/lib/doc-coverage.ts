// Модуль разнесён по частям в _doc-coverage/; здесь — прежний путь импорта.
export type { ColKey, Need, CellRule, RowRules, SectionKey, Cell, Gap, CovDoc } from "./_doc-coverage/shared";
export { COLUMNS, noAuctionInvoice, purchaseRules, tzRules, batchRules, paymentRules, contractRules, SECTION_ORDER, SECTION_TITLES, normTitle, PURCHASE_KIND_TO_TYPE, uniq, evaluate } from "./_doc-coverage/columns";
export { summarize, parseCovFilters, filterCovRows, docCoverageHint, computeDocCoverage } from "./_doc-coverage/compute-doc-coverage-impl";
export type { CovRow, SectionStat, DocCoverage, CovFilters } from "./_doc-coverage/compute-doc-coverage-impl";
