import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

const rubWhole = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
/** Порог, с которого копейки не показываются (экономия места в таблицах). Меньшие суммы — с копейками, чтобы были видны расхождения. */
export const MONEY_WHOLE_FROM = 1000;

/** Сумма в рублях: от 1 000 ₽ — целые рубли, меньше — с копейками (целые без «,00»). */
export function formatMoney(value: number | string) {
  const n = Number(value);
  if (Math.abs(n) >= MONEY_WHOLE_FROM) return rubWhole.format(n);
  return rubFormatter.format(n).replace(/,00(?=[\s\u00a0]?₽)/, "");
}

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

/** Formats a value in an arbitrary currency (purchases can be priced in USD/EUR before conversion). */
export function formatCurrency(value: number | string, currency: string) {
  let formatter = currencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
    currencyFormatterCache.set(currency, formatter);
  }
  return formatter.format(Number(value));
}

const qtyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 3,
});

export function formatQty(value: number | string) {
  return qtyFormatter.format(Number(value));
}

const pctFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Процент всегда с одним знаком после запятой: 12,3% / 90,0% / 0,0%. Положительное меньше 0,1 → «<0,1%». v — уже в процентах (12.3). */
export function formatPercent(v: number | string | null | undefined, opts?: { sign?: boolean }): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.1) return "<0,1%";
  const r = Math.round(Math.abs(n) * 10) / 10;
  const body = pctFormatter.format(r);
  const neg = n < 0 && r !== 0;
  return `${neg ? "−" : opts?.sign && r !== 0 ? "+" : ""}${body}%`;
}

/** Доля (0.123 → «12,3%»). */
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
  return `округление, ${formatMoney(Math.abs(Number(value)).toFixed(2))}`;
}
