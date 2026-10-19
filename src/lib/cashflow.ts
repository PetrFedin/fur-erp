// Cashflow: оплаты по статьям и месяцам. Чистая агрегация поверх loadPaymentsOverview (единый источник «Оплачено всего»,
// только COMPLETED); своей выборки и формул оплат здесь нет.
import type { OverviewRow } from "@/lib/payments-overview";

export type CashflowPeriod = "2025" | "2026" | "all";
export const CASHFLOW_YEARS = [2025, 2026] as const;

export const CASHFLOW_ARTICLES = [
  { key: "furAuction", label: "Мех: аукционы", hint: "Оплата партий меха по аукционам (SAGA, FH и др.) поставщику." },
  { key: "furPurchase", label: "Мех: закупка у поставщика", hint: "Оплата закупок меха напрямую и авансы поставщику без привязки к аукциону." },
  { key: "lining", label: "Подкладка", hint: "Оплата подкладочных тканей (доля подкладки в оплаченных закупках)." },
  { key: "services", label: "Аксессуары и услуги по УПД", hint: "Закупки без позиций сырья: услуги и аксессуары по УПД." },
  { key: "work", label: "Работа подрядчику", hint: "Оплата пошива подрядчику (Веллмех) по ТЗ, включая аванс, не разнесённый на ТЗ." },
  { key: "hides", label: "Шкуры подрядчика в счёте за пошив", hint: "Часть счёта подрядчика, отнесённая к шкурам, которые поставил подрядчик." },
] as const;
export type ArticleKey = (typeof CASHFLOW_ARTICLES)[number]["key"];
export type PayType = "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER";
export const TYPE_LABEL: Record<PayType, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный расчёт", OTHER: "Прочее / без вида" };
const TYPE_ORDER: PayType[] = ["ADVANCE", "PARTIAL", "FINAL", "OTHER"];

export type CashflowData = {
  period: CashflowPeriod;
  /** Месяцы периода: «2025-01» … */
  months: string[];
  articles: { key: ArticleKey; label: string; hint: string; byMonth: number[]; total: number; types: { type: PayType; label: string; byMonth: number[]; total: number }[] }[];
  monthTotals: number[];
  cumulative: number[];
  total: number;
  /** Оплаты вне 2025–2026 (в таблицу не попадают; нужны, чтобы Σ сходилась с «Оплачено всего»). */
  outside: number;
};

export function parsePeriod(v: string | string[] | undefined): CashflowPeriod {
  return v === "2025" || v === "2026" ? v : "all";
}

export function monthsOf(period: CashflowPeriod): string[] {
  const ys = period === "all" ? CASHFLOW_YEARS : [Number(period)];
  return ys.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`));
}

/** Статья строки: у сырья мех (аукцион / закупка) / подкладка / услуги, у производства — работа и шкуры (в OverviewRow шкуры лежат в поле fur). */
function split(r: OverviewRow): Record<ArticleKey, number> {
  const z = { furAuction: 0, furPurchase: 0, lining: 0, services: 0, work: 0, hides: 0 };
  if (r.kind === "raw") return { ...z, [r.edit === "auction" ? "furAuction" : "furPurchase"]: r.fur, lining: r.lining, services: r.services };
  return { ...z, work: r.work, hides: r.hides };
}

export function buildCashflow(rows: OverviewRow[], period: CashflowPeriod): CashflowData {
  const months = monthsOf(period);
  const idx = new Map(months.map((m, i) => [m, i]));
  const zeros = () => months.map(() => 0);
  const articles = CASHFLOW_ARTICLES.map((a) => ({
    key: a.key, label: a.label as string, hint: a.hint as string, byMonth: zeros(), total: 0,
    types: TYPE_ORDER.map((t) => ({ type: t, label: TYPE_LABEL[t], byMonth: zeros(), total: 0 })),
  }));
  let outside = 0;
  for (const r of rows) {
    const i = idx.get(r.iso.slice(0, 7));
    if (i === undefined) {
      if (period === "all") outside += r.amount;
      continue;
    }
    const s = split(r);
    for (const a of articles) {
      a.byMonth[i] += s[a.key];
      a.types.find((t) => t.type === r.type)!.byMonth[i] += s[a.key];
    }
  }
  for (const a of articles) {
    a.total = a.byMonth.reduce((x, y) => x + y, 0);
    for (const t of a.types) t.total = t.byMonth.reduce((x, y) => x + y, 0);
    a.types = a.types.filter((t) => Math.abs(t.total) > 0.005);
  }
  const keep = articles.filter((a) => Math.abs(a.total) > 0.005);
  const monthTotals = months.map((_, i) => keep.reduce((x, a) => x + a.byMonth[i], 0));
  let run = 0;
  const cumulative = monthTotals.map((v) => (run += v));
  return { period, months, articles: keep, monthTotals, cumulative, total: run, outside };
}
