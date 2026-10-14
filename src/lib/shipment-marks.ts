// Отметки Веллмеха по строкам примерки: «принято / не принято / замечание» с пометкой автора «Веллмех».
// Хранятся без миграции: один этап хронологии «Отметки Веллмеха по примерке» (side WELLMEKH) со строками ShipmentEventLine
// (accepted / rejected / comment). Эта таблица «приёмки по этапам» в нашем учёте и итогах не участвует, поэтому отметки Веллмеха
// сами ничего не меняют: они только показываются и ждут подтверждения нашей стороны (кнопка «Подтвердить» делает обычный наш переход).
export const MARKS_TITLE = "Отметки Веллмеха по примерке";
export type MarkKind = "ok" | "no" | "remark";
export const MARK_LABEL: Record<MarkKind, string> = { ok: "принято", no: "не принято", remark: "замечание" };

export type MarkRow = { lineId: string; kind: MarkKind; note: string };

/** Строка ShipmentEventLine → отметка. */
export function markOf(l: { shipmentLineId: string; accepted: number | null; rejected: number | null; comment: string | null }): MarkRow {
  const kind: MarkKind = (l.accepted ?? 0) > 0 ? "ok" : (l.rejected ?? 0) > 0 ? "no" : "remark";
  return { lineId: l.shipmentLineId, kind, note: l.comment ?? "" };
}

/** Совпадает ли отметка с тем, что уже стоит у нас: принято ↔ «Готов к отгрузке», не принято/замечание ↔ «На доработке». */
export function markConfirmed(kind: MarkKind, stage: "REVIEW" | "REWORK" | "READY"): boolean {
  return kind === "ok" ? stage === "READY" : stage === "REWORK";
}

export function marksSummary(marks: { kind: MarkKind }[]): string {
  const n = (k: MarkKind) => marks.filter((m) => m.kind === k).length;
  return `принято ${n("ok")}, не принято ${n("no")}, замечаний ${n("remark")}`;
}
