/** Крупные суммы в плитках: «587,9 млн ₽» (₽ не переносится). Полное значение — в title. */
export function formatCompactMoney(value: number | string): string {
  const n = Number(value);
  const abs = Math.abs(n);
  const nf = (v: number, d: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (abs >= 1_000_000) return `${nf(n / 1_000_000, 1)} млн ₽`;
  if (abs >= 100_000) return `${nf(n / 1_000, 0)} тыс. ₽`;
  return `${nf(n, 2)} ₽`;
}
