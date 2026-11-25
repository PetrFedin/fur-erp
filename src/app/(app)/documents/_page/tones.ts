export const pctTone = (p: number | null) =>
  p === null ? "text-neutral-500" : p >= 90 ? "text-emerald-700" : p >= 60 ? "text-amber-700" : "text-red-600";
export const barTone = (p: number | null) => (p === null ? "bg-neutral-300" : p >= 90 ? "bg-emerald-500" : p >= 60 ? "bg-amber-400" : "bg-red-500");

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
