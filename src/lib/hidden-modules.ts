/**
 * Модули, скрытые из меню, вкладок и кнопок на первом этапе (решение владельца).
 * Страницы по прямому адресу, код и данные остаются. Вернуть модуль — убрать его из списка
 * (или очистить массив целиком): вкладки, кнопки и плитки появятся снова.
 */
export const HIDDEN_MODULES: readonly string[] = ["shipments", "fittings", "plan", "supply-plan"];

export function isModuleHidden(key: string): boolean {
  return HIDDEN_MODULES.includes(key);
}
