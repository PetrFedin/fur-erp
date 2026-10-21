// Нули в таблицах и плитках не показываем: вместо «0 шт.», «0 ₽», «0 %» — пустое место. Работает по готовой строке («0 ₽», «0,0 шт.»).
const ZERO = /^[−-]?0(?:[.,]0+)?(?:[\s  ]*(?:₽|шт\.|шк\.|м|%))?$/;
export const isZeroText = (v: unknown): boolean => typeof v === "string" && ZERO.test(v.trim());
/** Нулевая строка → пусто, остальное без изменений. */
export const blankZero = (s: string): string => (isZeroText(s) ? "" : s);
