/**
 * Единое правило режима «4 %» для сумм «Использовано» (полосы итогов, карточки, плитки): одна сумма по режиму шапки.
 * «С 4 %» — списано плюс надбавка и отдельно сама надбавка («в т.ч. 4 %»); «Без 4 %» — списано как есть и никаких упоминаний 4 %.
 * Без серверных зависимостей: подходит и серверным страницам, и клиентским компонентам.
 */
export type C4 = "on" | "off";

/** Показывать ли надбавку 4 % (режим «С 4 %»). */
export const withExtra = (c4: C4): boolean => c4 === "on";

export function usedByMode(c4: C4, used: number, extra: number): { value: number; extra: number } {
  const on = c4 === "on";
  return { value: on ? used + extra : used, extra: on && extra > 0.5 ? extra : 0 };
}
