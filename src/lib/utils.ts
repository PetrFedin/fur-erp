import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ПРАВИЛО ПОКАЗА ЧИСЕЛ (решение владельца 15.10.2026; только экран, данные и расчёты точные):
//   • деньги, количества, проценты, цены за единицу, шкуры, метры, площади — ЦЕЛЫЕ;
//   • малые значения (по модулю < 1 у денег и процентов, < 10 у количеств) — максимум 1 знак, чтобы 0,4 не стало «0»;
//   • курс валют и наценки (множитель ×1,25, % наценки) — ровно 2 знака: formatRate / formatMarkup / formatMarkupPct.
const nfWhole = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nfOne = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const nfTwo = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Число по общему правилу: целое; если |n| < smallBelow — максимум 1 знак. */
export function formatNum(value: number | string, smallBelow = 10): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= smallBelow) return nfWhole.format(n);
  const r = nfOne.format(n);
  return r === "-0" || r === "−0" ? "0" : r;
}

/** Курс валют: всегда 2 знака (92,45). */
export function formatRate(value: number | string): string {
  const n = Number(value);
  return Number.isFinite(n) ? nfTwo.format(n) : "—";
}

/** Наценка множителем: ×1,25 (всегда 2 знака). */
export function formatMarkup(value: number | string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `×${nfTwo.format(n)}` : "—";
}

/** Наценка в процентах: 25,00% (всегда 2 знака). v уже в процентах. */
export function formatMarkupPct(value: number | string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${nfTwo.format(n)}%` : "—";
}

const rubFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rubSmall = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 1 });
/** Устарело: раньше от этой суммы пропадали копейки; теперь копеек нет нигде (кроме |сумма| < 1 ₽). Оставлено для совместимости импортов. */
export const MONEY_WHOLE_FROM = 1;

/** Сумма в рублях: целые рубли; меньше 1 ₽ по модулю — один знак («0,4 ₽»), чтобы малая сумма не стала «0». */
export function formatMoney(value: number | string) {
  let n = Number(value);
  if (!Number.isFinite(n)) return rubFormatter.format(n);
  if (Math.abs(n) < 0.05) n = 0; // «-0 ₽» не показываем
  if (Math.abs(n) >= 0.95) return rubFormatter.format(n);
  return rubSmall.format(n);
}

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

/** Formats a value in an arbitrary currency (purchases can be priced in USD/EUR before conversion): целые, меньше 1 — один знак. */
export function formatCurrency(value: number | string, currency: string) {
  const n = Number(value);
  const small = Math.abs(n) < 0.95;
  const key = `${currency}:${small ? 1 : 0}`;
  let formatter = currencyFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: small ? 1 : 0,
    });
    currencyFormatterCache.set(key, formatter);
  }
  return formatter.format(n);
}

/** Количество (шт., м, кг, дм², шкуры): целое; меньше 10 — максимум 1 знак (0,5 м; 1,4 шкуры). */
export function formatQty(value: number | string) {
  return formatNum(value, 10);
}

/** Процент: целый; меньше 1% — один знак (0,4%); положительное меньше 0,1 → «<0,1%». v — уже в процентах (12.3). Наценку так НЕ форматировать: formatMarkupPct. */
export function formatPercent(v: number | string | null | undefined, opts?: { sign?: boolean }): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.1) return "<0,1%";
  const body = formatNum(Math.abs(n), 1);
  const zero = body === "0";
  const neg = n < 0 && !zero;
  return `${neg ? "−" : opts?.sign && !zero ? "+" : ""}${body}%`;
}

/** Доля (0.123 → «12%»). */
export function formatShare(fraction: number | null | undefined, opts?: { sign?: boolean }): string {
  return fraction == null ? "—" : formatPercent(fraction * 100, opts);
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(value: Date | string) {
  return dateFormatter.format(new Date(value));
}

/** Порог (₽), с которого отрицательный долг считается переплатой; меньшие отклонения — округления, показываются как есть. */
export const OVERPAY_FROM = 0.5;

/** Долг/остаток к оплате: отрицательное значение — «Переплата N ₽» (положительное число); иначе обычная сумма. Только отображение, расчёты не меняются. */
export function formatDebt(value: number | string, fmt: (v: number) => string = formatMoney): string {
  const n = Number(value);
  return n < -OVERPAY_FROM ? `Переплата ${fmt(Math.abs(n))}` : fmt(n);
}

/** Подпись колонки/плитки долга: «Переплата», когда вся величина отрицательна, иначе base («Долг», «К оплате»…). */
export function debtLabel(value: number | string, base = "Долг"): string {
  return Number(value) < -OVERPAY_FROM ? "Переплата" : base;
}

/** Остаток меньше 1 ₽ по модулю — копеечное округление, а не долг/переплата. */
export const ROUNDING_REST_MAX = 1;
/** Относительный «хвост»: до 100 ₽ и не больше 0,0001 % от суммы (округление НДС и целых рублей по нескольким оплатам). */
const ROUNDING_REST_REL = 1e-6;
const ROUNDING_REST_ABS = 100;

/** Остаток считать округлением: |остаток| < 1 ₽, либо мелкий хвост (до 100 ₽) от очень большой суммы. base — сумма закупки/партии/аукциона. Только отображение. */
export function isRoundingRest(value: number | string, base?: number | string): boolean {
  const a = Math.abs(Number(value));
  if (!(a > 0)) return false;
  if (a < ROUNDING_REST_MAX) return true;
  const b = Math.abs(Number(base ?? 0));
  return a <= ROUNDING_REST_ABS && b > 0 && a / b <= ROUNDING_REST_REL;
}

/** Подсказка для остатка-округления: «округление, 0,40 ₽». */
export function roundingRestHint(value: number | string): string {
  return `округление, ${formatMoney(Math.abs(Number(value)))}`;
}
