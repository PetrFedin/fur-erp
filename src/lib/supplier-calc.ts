// Модуль разнесён по частям в _supplier-calc/; здесь — прежний путь импорта.
export { evalNum } from "./_supplier-calc/shared";
export type { CalcFormat, CalcRow, ExtraExpense, CalcHeader, CalcStage, ColRule, CustomCol, CheckDiff, CalcParam, CalcPayload, RowCalc, SheetCol } from "./_supplier-calc/shared";
export { FORMAT_LABEL, columnsFor, STAGE_LABEL, rowFilled, newId, ensureRowIds, rateCols, headerRate, resolveRow, missingRates, calcYear, calcMonth, emptyHeader, emptyRow, emptyPayload, switchFormat, effectiveRate, extraPerHide, calcRow, UNIT_COL, QTY_COL, sheetColumns, paramKey, paramNameProblem, paramValues, paramList, calcVatPct, lotKey, colLetterOf, matchRule } from "./_supplier-calc/format-label";
export type { RateInfo, Col } from "./_supplier-calc/format-label";
export { computeSheet, calcAll, checkDiffs, sendProblems, auctionNameFromTitle, payloadFromTable, syncLetters, remapCustomRefs, columnUsers } from "./_supplier-calc/compute-sheet";
export type { CalcTotals, Cell, Sheet } from "./_supplier-calc/compute-sheet";
