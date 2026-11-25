// Сезоны, показатели сезона и чистые формулы отчёта «заказ и продажи» (вынесено из season-report.tsx без изменений).
// Валюта таблицы (CUR_EUR) и форматтеры, которые её читают, остаются в season-report.tsx — переменная одна.
import type { ReportSizeRow } from "@/lib/margin-tree";
import { furRuLabel } from "@/lib/sales-receipts-core";
import { DASH } from "../sales-fmt";

export const SEASONS = ["FW25/26", "SS26", "FW26/27"] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { "FW26/27": "FW 26/27", SS26: "SS 2026", "FW25/26": "FW 25/26" };
/** Сезон строки файла → ключ отчёта. */
export const SALES_TO_REPORT: Record<string, Season> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };
export const SEASON_BG: Record<Season, string> = { "FW26/27": "bg-sky-50/60", SS26: "bg-amber-50/60", "FW25/26": "bg-emerald-50/50" };
export type Level = "fur" | "cat1" | "cat2" | "article" | "color" | "size";
/** Два порядка разворота (04.11.2026, владелец): мех → кат.1 → кат.2 или кат.1 → кат.2 → мех; дальше артикул → цвет → размер. */
export const HIER = { fur: ["fur", "cat1", "cat2", "article", "color", "size"] as Level[], cat: ["cat1", "fur", "cat2", "article", "color", "size"] as Level[] };
export const LEVEL_LABEL: Record<Level, string> = { fur: "Мех", cat1: "Категория 1", cat2: "Категория 2", article: "Артикул", color: "Цвет", size: "Размер" };

export const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
export const furRu = (k: string) => furRuLabel(k, FUR_RU);
/** В отчётах «Продажи / Поставки» (как в PDF владельца): «Свакара», «Соболь+Норка» отдельной группой. */
export const FUR_REPORT: Record<string, string> = { ...FUR_RU, SWAKARA: "Свакара" };

/** Показатели сезона. По SS26 и FW25 заказ закрыт: заказано = поступило (правило владельца 21.10.2026). */
export type M = {
  /** Артикулов сезона: разные артикулы, у которых есть заказ, приход или продажи. */
  arts: number;
  conf: number; confEur: number; deliv: number; delivEur: number;
  /** За сезон: товар этого сезона, проданный в календаре этого же сезона. */
  ssn: number; rubS: number; rubSIn: number; rubSEx: number; eurSIn: number; eurSEx: number; discS: number; grossS: number; costS: number;
  /** Всего в календаре сезона: товар сезона (SSN) + олды — товар прошлых сезонов, проданный в этом календаре. По отчёту: FW25 94, SS26 13 + 41 = 54, FW26 60 + 51 = 111. */
  all: number; rubA: number; rubAIn: number; discA: number; grossA: number; costA: number;
  /** Остаток товара сезона = поступило − продано товара сезона за всё время (allG). */
  stock: number;
  /** Товар сезона, проданный за всё время (в свой сезон и позже) — для SO сейчас и остатка. */
  allG: number;
  /** Штуки отчёта (для весов цены и маркапа: выручка и скидка тоже из отчёта). */
  ssnR: number; allR: number;
  /** Товар этого сезона, проданный позже: в календаре SS26 и в календаре FW26 (всего allG = в свой сезон + эти две части). */
  lSS26: number; lFW26: number;
  /** Выручка товара сезона, проданного позже (rubL), и за всё время = в свой сезон + позже (rubG); с НДС или без — как в шапке. */
  rubL: number; rubG: number;
  /** Позже проданное: выручка с НДС, скидка ₽ и числитель/знаменатель маркапа (€) — для цены и MU «товара сезона за всё время». */
  rubLIn: number; discL: number; grossL: number; costL: number;
};
export const MKEYS = ["arts", "conf", "confEur", "deliv", "delivEur", "ssn", "rubS", "rubSIn", "rubSEx", "eurSIn", "eurSEx", "discS", "grossS", "costS", "all", "rubA", "rubAIn", "discA", "grossA", "costA", "stock", "allG", "ssnR", "allR", "lSS26", "lFW26", "rubL", "rubG", "rubLIn", "discL", "grossL", "costL"] as const;
export const zero = (): M => Object.fromEntries(MKEYS.map((k) => [k, 0])) as M;
export const plus = (a: M, b: M): M => Object.fromEntries(MKEYS.map((k) => [k, a[k] + b[k]])) as M;
/** SO за сезон: продано за сезон ÷ заказано (итог сезона). SO сейчас: товар сезона, проданный за всё время, ÷ заказано. */
export const soS = (m: M) => (m.conf > 0 ? m.ssn / m.conf : null);
export const soA = (m: M) => (m.conf > 0 ? m.allG / m.conf : null);
/** Средневзвешенная цена продажи до скидки = (выручка + скидка) ÷ шт.; маркап = то же ÷ себестоимость проданного. */
export const priceS = (m: M) => (m.ssnR > 0 ? (m.rubSIn + m.discS) / m.ssnR : null);
export const priceA = (m: M) => (m.allR > 0 ? (m.rubAIn + m.discA) / m.allR : null);
/** Олды календаря сезона = весь календарь минус товар сезона. */
export const priceO = (m: M) => (m.allR - m.ssnR > 0 ? (m.rubAIn - m.rubSIn + m.discA - m.discS) / (m.allR - m.ssnR) : null);
export const mkO = (m: M) => (m.costA - m.costS > 0 ? (m.grossA - m.grossS) / (m.costA - m.costS) : null);
/** Товар сезона за всё время (в свой сезон и позже): цена до скидки и маркап (выручка ₽ + скидка ₽) ÷ курс ÷ SC EUR. */
export const priceG = (m: M) => (m.allG > 0 ? (m.rubSIn + m.rubLIn + m.discS + m.discL) / m.allG : null);
export const mkG = (m: M) => (m.costS + m.costL > 0 ? (m.grossS + m.grossL) / (m.costS + m.costL) : null);
export const mkS = (m: M) => (m.costS > 0 ? m.grossS / m.costS : null);
export const mkA = (m: M) => (m.costA > 0 ? m.grossA / m.costA : null);
/** Значение столбца для сортировки (пустое → самые маленькие). */
export const numOf = (m: M, key: string): number => ({ arts: m.arts, conf: m.conf, deliv: m.deliv, wait: Math.max(0, m.conf - m.deliv), ssn: m.ssn, soS: soS(m) ?? -1, all: m.all, goods: m.allG, soA: soA(m) ?? -1, left: m.stock, rubS: m.rubS, rubA: m.rubA, priceS: priceS(m) ?? -1, priceA: priceA(m) ?? -1, mkS: mkS(m) ?? -1, mkA: mkA(m) ?? -1 } as Record<string, number>)[key] ?? 0;
export const eur = (v: number) => (Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU") + " €");

export type Col = { key: string; label: string; short: string; hint: string; get: (m: M, s: Season) => string; /** Мелкая подпись под значением (проценты). */ sub?: (m: M) => string; strong?: boolean; full?: boolean };
/** Разложить целое `total` по долям `weights` целыми числами (метод наибольшего остатка), не больше `caps[i]`; сумма = total, если хватает ёмкости. */
export function apportion(total: number, weights: number[], caps?: number[]): number[] {
  const n = weights.length, out = new Array<number>(n).fill(0);
  if (!n || total <= 0) return out;
  const cap = (i: number) => (caps ? Math.max(0, caps[i]) : Infinity);
  const sw = weights.reduce((a, w) => a + Math.max(0, w), 0);
  const ideal = weights.map((w) => (sw > 0 ? (Math.max(0, w) / sw) * total : total / n));
  for (let i = 0; i < n; i++) out[i] = Math.min(Math.floor(ideal[i]), cap(i));
  let left = total - out.reduce((a, x) => a + x, 0);
  while (left > 0) {
    let best = -1, bestR = -1;
    for (let i = 0; i < n; i++) if (out[i] < cap(i)) { const r = ideal[i] - out[i]; if (r > bestR) { bestR = r; best = i; } }
    if (best < 0) break;
    out[best]++; left--;
  }
  return out;
}

export type Node = { id: string; level: Level; label: string; sub?: string; modelCode: string | null; variant: string | null; rows: ReportSizeRow[]; m: Record<Season, M>; stock: number; children: Node[] };
/** Продажи товара сезона позже его календаря: показатели одной пары «период продажи → сезон товара». */
export type Agg = { pcs: number; rubIn: number; rubEx: number; disc: number; grossC: number; costS: number };
/** Приход и продажи товара по сезонам из файла «поступления и продажи». */
export type LAgg = Record<Season, { deliv: number; ssn: number; all: number }>;
