/**
 * «Подтверждена с замечанием»: замечание хранится текстом в уже существующих полях (колонка не нужна):
 * у закупок/ТЗ/партий — `verifyNote` вида «Вопреки замечаниям: …», у оплат — строка в заметке оплаты «… вопреки замечаниям: …».
 */
export function remarkOf(note: string | null | undefined): string | null {
  if (!note) return null;
  const all = [...note.matchAll(/вопреки замечаниям:\s*([^\n]*)/gi)];
  const last = all[all.length - 1]?.[1]?.trim();
  return last || null;
}
/** Для оплат: достаём из заметки только строку с замечанием (остальные заметки в строку подтверждения не попадают). */
export function payNoteOf(notes: string | null | undefined): string | null {
  const r = remarkOf(notes);
  return r ? `Вопреки замечаниям: ${r}` : null;
}

/** Единые подписи статусов (docs/terms-glossary.md): три статуса подтверждения + «с замечанием». */
export const STATUS_LABEL = {
  docs: "подтверждено документом",
  letter: "согласовано письмом",
  none: "не подтверждено",
  remark: "подтверждена с замечанием",
} as const;
