// Даты календаря. Все даты — «календарные дни» в UTC (как их хранит база: полночь UTC), без часовых поясов.

export const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const parseYmd = (s: string) => new Date(`${s}T00:00:00.000Z`);

export function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/** «2026-10» → корректный месяц или null. */
export function parseMonth(s: string | undefined | null): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s ?? "");
  return m && Number(m[1]) >= 1990 && Number(m[1]) <= 2100 ? `${m[1]}-${m[2]}` : null;
}

export function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const monthTitle = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

/** День недели 0=пн … 6=вс. */
export const weekdayOf = (s: string) => (parseYmd(s).getUTCDay() + 6) % 7;

export function startOfWeek(s: string): string {
  return addDays(s, -weekdayOf(s));
}

/** Все дни сетки месяца: с понедельника первой недели по воскресенье последней. */
export function monthGridDays(m: string): string[] {
  const first = `${m}-01`;
  const start = startOfWeek(first);
  const next = `${shiftMonth(m, 1)}-01`;
  const last = addDays(next, -1);
  const end = addDays(last, 6 - weekdayOf(last));
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function rangeDays(from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < cap; d = addDays(d, 1)) out.push(d);
  return out;
}

export const dayLabel = (s: string) => {
  const d = parseYmd(s);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3).toLowerCase()}`;
};
export const fmtRu = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
