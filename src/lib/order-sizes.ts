/**
 * Размеры ТЗ: единый разбор строки ProductionOrder.size для фильтра «ТЗ ↔ размер».
 * Данные не переписываются: хелпер читает то, что уже записано («44, 46», «42,42,44», «6 6 7 7 8», «единый размер», «NS», «165*24», «58.58»).
 *  - числовые размеры (40–64) и перчаточные (6–8) → список уникальных значений по возрастанию: «44, 46, 46» → ['44','46'];
 *  - «единый», «единый размер», «NS» → kind 'single' (отдельное значение фильтра SINGLE_SIZE = «Единый размер»);
 *  - «165*24», «160*24», «165*9,5» (длина*ширина аксессуара) → kind 'dimension', значение «165*24»;
 *  - пусто → kind 'none'.
 */
export const SINGLE_SIZE = "Единый размер";

export type ParsedOrderSizes = {
  kind: "sizes" | "single" | "dimension" | "none";
  /** Уникальные значения для фильтра (для 'single' — [SINGLE_SIZE]). */
  sizes: string[];
  /** Все размеры по числу изделий, как в записи («44, 46, 46» → 3 штуки), только для kind 'sizes'. */
  perUnit: string[];
};

export function parseOrderSizesDetailed(size: string | null | undefined): ParsedOrderSizes {
  const raw = (size ?? "").trim();
  if (!raw) return { kind: "none", sizes: [], perUnit: [] };
  if (/^(?:един\S*(?:\s+размер)?|ns|one\s*size)$/i.test(raw)) return { kind: "single", sizes: [SINGLE_SIZE], perUnit: [] };
  const dim = /^(\d+(?:[.,]\d+)?)\s*[*x×хХ]\s*(\d+(?:[.,]\d+)?)$/.exec(raw);
  if (dim) return { kind: "dimension", sizes: [`${dim[1]}*${dim[2]}`], perUnit: [] };
  // «58.58» — два размера 58, слипшихся через точку (так записано в БД и реестре); «6.5» не трогаем (уникальные 2-значные одинаковые половины)
  let t = raw.replace(/\b(\d{2})\.(\d{2})\b/g, (m, a, b) => (Number(a) >= 36 && Number(b) >= 36 ? `${a} ${b}` : m));
  t = t.replace(/\(.*?\)/g, " ");
  const perUnit: string[] = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+))?/g)) {
    const n = m[1];
    const times = m[2] ? Number(m[2]) : 1;
    for (let i = 0; i < times; i++) perUnit.push(n);
  }
  if (perUnit.length === 0) return { kind: "none", sizes: [], perUnit: [] };
  const sizes = [...new Set(perUnit)].sort((a, b) => Number(a) - Number(b));
  return { kind: "sizes", sizes, perUnit };
}

/** Список размеров ТЗ для фильтра: «44, 46» → ['44','46']; «единый» → ['Единый размер']; нет → []. */
export function parseOrderSizes(size: string | null | undefined): string[] {
  return parseOrderSizesDetailed(size).sizes;
}

/** ТЗ попадает под фильтр по размеру (пусто — подходит всё). */
export function orderHasSize(size: string | null | undefined, wanted: string | null | undefined): boolean {
  if (!wanted) return true;
  return parseOrderSizes(size).includes(wanted === "единый" ? SINGLE_SIZE : wanted);
}

/** Все размеры, встречающиеся в наборе ТЗ (для выпадающего списка фильтра): числа по возрастанию, затем размеры-габариты, «Единый размер» последним. */
export function collectOrderSizes(sizes: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const s of sizes) for (const x of parseOrderSizes(s)) set.add(x);
  const rank = (x: string) => (x === SINGLE_SIZE ? 2 : x.includes("*") ? 1 : 0);
  return [...set].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? Number(a) - Number(b) : a.localeCompare(b, "ru")));
}
