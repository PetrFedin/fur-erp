// Коды моделей в данных записаны вперемешку латиницей и кириллицей (M012 и М038).
// Данные не меняем: для сортировки и поиска сравниваем нормализованный код (кириллица -> латиница).
const CYR_TO_LAT: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X",
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x",
};
const LAT_TO_CYR: Record<string, string> = Object.fromEntries(Object.entries(CYR_TO_LAT).map(([c, l]) => [l, c]));

const swap = (s: string, map: Record<string, string>) => s.replace(/./g, (ch) => map[ch] ?? ch);

/** «М012» (кириллица) -> «M012» (латиница): для сортировки и сравнения. */
export const normalizeModelCode = (s: string) => swap(s, CYR_TO_LAT);

/** Варианты поискового запроса (как введён, латиницей, кириллицей) для поиска «M012» и «М012» одним запросом. */
export function modelCodeVariants(q: string): string[] {
  return Array.from(new Set([q, swap(q, CYR_TO_LAT), swap(q, LAT_TO_CYR)])).filter(Boolean);
}

/** Сравнение названий моделей по нормализованному коду (латиница/кириллица не разводят порядок). */
export function compareModelNames(a: string, b: string): number {
  return normalizeModelCode(a).localeCompare(normalizeModelCode(b), "ru", { numeric: true });
}
