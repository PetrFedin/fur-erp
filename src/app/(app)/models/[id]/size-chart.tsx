export type SizeRow = { size: string; q: number };
export const NO_SIZE = "Не указан";

const RANK = ["XXXL", "XXL", "XL", "L", "M", "S", "XS"];
/** Порядок размеров: буквенные от крупных к мелким, числовые по возрастанию, «Не указан» последним. */
export function sortSizes(a: string, b: string): number {
  if (a === NO_SIZE || b === NO_SIZE) return a === NO_SIZE ? (b === NO_SIZE ? 0 : 1) : -1;
  const ra = RANK.indexOf(a.split(",")[0]), rb = RANK.indexOf(b.split(",")[0]);
  if (ra >= 0 || rb >= 0) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b, "ru");
  return a.localeCompare(b, "ru", { numeric: true });
}
