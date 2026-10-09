// Форматирование чисел раздела «Бюджет» (без "use client": годится и серверным страницам).

export const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("ru-RU") + " ₽");
export const qty = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: d }));
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
export const share = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—");
export const dateRu = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
