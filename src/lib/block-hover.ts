// Подсветка по наведению: элемент с data-hover-block="K" (плитка, строка-заголовок блока) подсвечивает все элементы с data-block~="K"
// (строки таблиц, относящиеся к блоку). Без перерисовки React: см. src/components/block-hover.tsx и класс .block-hl в theme-customer.css.

/** Безопасный ключ из названия («Без группы» → «Без_группы»). */
export const slugBlock = (s: string): string => s.replace(/\s+/g, "_").replace(/"/g, "");
/** Ключ группы категорий (Одежда / Аксессуары): плитки слайдов ↔ строки таблицы «Производство…». */
export const grpBlock = (g: string): string => "grp-" + slugBlock(g);
/** Короткий стабильный ключ узла дерева по его пути. */
export function pathBlock(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h * 33) ^ path.charCodeAt(i)) >>> 0;
  return "t" + h.toString(36);
}
