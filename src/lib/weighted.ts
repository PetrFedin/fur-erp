// Среднее взвешенное — единственный способ считать «среднее» в системе:
//  • цена лота и себестоимость единицы — вес: количество шкур;
//  • курс — вес: сумма закупки в валюте (цена × кол-во);
//  • проценты — вес: база, от которой считается процент.
// Нулевой (или некорректный) суммарный вес даёт null, а не NaN/Infinity.

export type WeightedItem = { value: number; weight: number };

/** Σ(значение × вес) ÷ Σ вес. Пары с нечисловыми/отрицательными значениями или весом пропускаются. Σ вес = 0 → null. */
export function weightedAvg(items: Iterable<WeightedItem>): number | null {
  let sum = 0;
  let w = 0;
  for (const it of items) {
    if (!Number.isFinite(it.value) || !Number.isFinite(it.weight) || it.weight <= 0) continue;
    sum += it.value * it.weight;
    w += it.weight;
  }
  return w > 0 ? sum / w : null;
}

/** Отношение сумм: числитель ÷ знаменатель (= среднее взвешенное, когда числитель — Σ значение × вес). 0 в знаменателе → null. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Процент, взвешенный по базе: Σ(доля% × база) ÷ Σ база. */
export function weightedPercent(items: Iterable<{ percent: number; base: number }>): number | null {
  return weightedAvg(Array.from(items, (i) => ({ value: i.percent, weight: i.base })));
}

export const WEIGHT_TIP = {
  qty: "взвешено по количеству шкур",
  amount: "взвешено по сумме закупки",
} as const;
