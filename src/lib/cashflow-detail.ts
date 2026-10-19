// Детализация плиток Cashflow: чистые функции над теми же рядами, что и сами плитки; итоги деталей равны значению плитки (проверяется тестом).
import type { CatClass, SalesAggLine } from "@/lib/sales-receipts-core";
import type { OverviewRow } from "@/lib/payments-overview";
import { split, type ArticleKey } from "@/lib/cashflow";

export type PayType = "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER";
export const PAY_TYPE_LABEL: Record<PayType, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный расчёт", OTHER: "Прочее / без вида" };
/** Платёж для детализации: сумма с НДС и без НДС (по правилу «Без НДС» из cashflow.ts), что оплачено и документ. */
/** art — суммы платежа по статьям (с НДС; без НДС умножаются на ex/amount); tz — для оплат работы: доля работы по ТЗ с категорией ТЗ. */
export type PayLite = { id: string; iso: string; amount: number; ex: number; label: string; doc: string | null; href: string; type: PayType; art: Partial<Record<ArticleKey, number>>; tz: { label: string; href: string; amount: number; cls: CatClass }[] };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const inMonths = (iso: string, months: string[]) => months.includes(iso.slice(0, 7));

export function spendByType(pays: PayLite[], months: string[], ex: boolean) {
  const ps = pays.filter((p) => inMonths(p.iso, months));
  return (Object.keys(PAY_TYPE_LABEL) as PayType[]).map((t) => ({ type: t, label: PAY_TYPE_LABEL[t], total: sum(ps.filter((p) => p.type === t).map((p) => (ex ? p.ex : p.amount))) })).filter((r) => Math.abs(r.total) > 0.005);
}
export function topPays(pays: PayLite[], months: string[], ex: boolean, n = 5) {
  return pays.filter((p) => inMonths(p.iso, months)).sort((a, b) => (ex ? b.ex - a.ex : b.amount - a.amount)).slice(0, n);
}

/** pcs — нетто (после возвратов); grossPcs — валовое продано; returnsPcs/returnsRub — возвраты (положительным числом; ₽ с НДС или без — как rev). pcs = grossPcs − returnsPcs. */
export type Grp = { key: string; pcs: number; rev: number; grossPcs: number; returnsPcs: number; returnsRub: number };
/** Продажи по ключу (сезон / категория / артикул / месяц) за месяцы периода; выручка — с НДС или без. */
export function groupSales(lines: SalesAggLine[], months: string[], ex: boolean, key: (l: SalesAggLine) => string, cat: CatClass | "all" = "all"): Grp[] {
  const by = new Map<string, Grp>();
  for (const l of lines) {
    if (l.kind !== "SALE" || !inMonths(l.iso, months) || (cat !== "all" && l.cls !== cat)) continue;
    const k = key(l);
    const g = by.get(k) ?? { key: k, pcs: 0, rev: 0, grossPcs: 0, returnsPcs: 0, returnsRub: 0 };
    g.pcs += l.pcs; g.rev += ex ? l.retailRubExVat : l.retailRub;
    if (l.pcs > 0) g.grossPcs += l.pcs;
    else if (l.pcs < 0) { g.returnsPcs += -l.pcs; g.returnsRub += -(ex ? l.retailRubExVat : l.retailRub); }
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.rev - a.rev);
}

/** Точки разворота чистого потока: первый месяц, когда накопленный итог стал расти (месячный чистый > 0), самый глубокий накопленный минус и максимальная просадка накопленного от пика. */
export function flowPoints(months: string[], net: number[], cum: number[]) {
  const firstPositive = months.find((_, i) => net[i] > 0.005) ?? null;
  let deepest = { month: months[0] ?? "", cum: cum[0] ?? 0 };
  let peak = cum[0] ?? 0, drawdown = 0;
  cum.forEach((v, i) => { if (v < deepest.cum) deepest = { month: months[i], cum: v }; peak = Math.max(peak, v); drawdown = Math.max(drawdown, peak - v); });
  return { firstPositive, deepest, drawdown };
}

/** Burn rate: средние траты в месяц за последние n месяцев ряда (месяцы без трат в конце не берутся). */
export function burnRate(spend: number[], n = 3): number | null {
  let last = spend.length - 1;
  while (last >= 0 && Math.abs(spend[last]) < 0.005) last--;
  if (last < 0) return null;
  const from = Math.max(0, last - n + 1);
  const part = spend.slice(from, last + 1);
  return sum(part) / part.length;
}

/** Срок возврата вложений: линейная оценка — накопленный минус ÷ средний чистый поток за последние n месяцев; только при положительном среднем потоке. */
export function paybackMonths(cumNetEnd: number, net: number[], n = 3): number | null {
  if (cumNetEnd >= 0) return 0;
  let last = net.length - 1;
  while (last > 0 && Math.abs(net[last]) < 0.005) last--;
  const part = net.slice(Math.max(0, last - n + 1), last + 1);
  const avg = part.length ? sum(part) / part.length : 0;
  return avg > 0.005 ? -cumNetEnd / avg : null;
}

/** Компактные платежи для клиента: сумма с НДС и без НДС (доля НДС платежа из vatShares), статьи и ТЗ. */
export function payLites(rows: OverviewRow[], share: Map<string, number>, orderCls: Map<string, CatClass> = new Map()): PayLite[] {
  return rows.map((r) => {
    const art = split(r);
    const k = r.amount !== 0 ? r.work / r.amount : 0;
    const tz = r.kind === "prod" ? r.parts.filter((p) => p.href?.startsWith("/production/")).map((p) => ({ label: p.label, href: p.href!, amount: p.amount * k, cls: orderCls.get(p.href!.slice("/production/".length)) ?? ("other" as CatClass) })) : [];
    return { id: r.id, iso: r.iso, amount: r.amount, ex: r.amount * (1 - (share.get(r.id) ?? 0)), label: r.label, doc: r.doc, href: r.href, type: r.type, art, tz };
  });
}

/** Детализация одной статьи трат: по видам платежа (сумма, число), по месяцам, список платежей этой статьи. Итог = значение статьи в таблице. */
export function spendByArticle(pays: PayLite[], months: string[], ex: boolean, key: ArticleKey) {
  const list = pays.filter((p) => inMonths(p.iso, months) && (p.art[key] ?? 0) !== 0).map((p) => {
    const f = ex && p.amount !== 0 ? p.ex / p.amount : 1;
    return { pay: p, amount: (p.art[key] ?? 0) * f };
  });
  const total = sum(list.map((x) => x.amount));
  const byType = (Object.keys(PAY_TYPE_LABEL) as PayType[]).map((t) => { const l = list.filter((x) => x.pay.type === t); return { type: t, label: PAY_TYPE_LABEL[t], total: sum(l.map((x) => x.amount)), count: l.length }; }).filter((r) => r.count > 0);
  const byMonth = months.map((m) => ({ month: m, total: sum(list.filter((x) => x.pay.iso.startsWith(m)).map((x) => x.amount)) }));
  return { total, byType, byMonth, list };
}

/** Работа по ТЗ (партиям): строки ТЗ с суммой работы и категорией; cls — фильтр категории («all» — все). */
export function workByTz(pays: PayLite[], months: string[], cls: CatClass | "all") {
  const by = new Map<string, { label: string; href: string; cls: CatClass; amount: number; count: number }>();
  const unlinked = { amount: 0, count: 0 };
  for (const p of pays) {
    if (!inMonths(p.iso, months) || Math.abs(p.art.work ?? 0) < 0.005) continue;
    const linked = sum(p.tz.map((t) => t.amount));
    for (const t of p.tz) {
      if (cls !== "all" && t.cls !== cls) continue;
      const e = by.get(t.href) ?? { label: t.label, href: t.href, cls: t.cls, amount: 0, count: 0 };
      e.amount += t.amount; e.count++; by.set(t.href, e);
    }
    const rest = (p.art.work ?? 0) - linked;
    if (Math.abs(rest) > 0.005 && (cls === "all" || cls === "other")) { unlinked.amount += rest; unlinked.count++; }
  }
  const rows = [...by.values()].sort((a, b) => b.amount - a.amount);
  return { rows, unlinked, total: sum(rows.map((r) => r.amount)) + unlinked.amount };
}

/** Окна «Работа в месяц» / «Работа на единицу»: показатели по выбранной базе месяцев. base «all» — все месяцы проекта, «active» — месяцы с движением (маска). */
export function workWindowStats(work: number[], units: number[], mask: boolean[], base: "all" | "active") {
  const inc = work.map((_, i) => (base === "all" ? true : !!mask[i]));
  const n = inc.filter(Boolean).length;
  const total = sum(work.filter((_, i) => inc[i]));
  const unitsTotal = sum(units.filter((_, i) => inc[i]));
  const ratios = work.map((w, i) => (inc[i] && units[i] > 0 ? { i, v: w / units[i] } : null)).filter((x): x is { i: number; v: number } => x !== null);
  const sorted = [...ratios].sort((a, b) => a.v - b.v);
  return {
    inc, n, m: work.length, total, unitsTotal,
    avgMonth: n ? total / n : null, avgUnits: n ? unitsTotal / n : null,
    perUnit: unitsTotal > 0 ? total / unitsTotal : null,
    /** Простое среднее месячных значений ₽/шт. (месяцы с приходом) — в отличие от взвешенного perUnit. */
    simpleAvg: ratios.length ? sum(ratios.map((r) => r.v)) / ratios.length : null,
    min: sorted[0] ?? null, max: sorted[sorted.length - 1] ?? null,
  };
}

/** Оплата работы по месяцам и видам платежа (аванс / доплата / окончательный / прочее); cls — категория по ТЗ→модель («all» — вся работа, включая без привязки). Σ видов по месяцу = работа за месяц. */
export function workKindsByMonth(pays: PayLite[], months: string[], cls: CatClass | "all"): Record<PayType, number[]> {
  const out: Record<PayType, number[]> = { ADVANCE: months.map(() => 0), PARTIAL: months.map(() => 0), FINAL: months.map(() => 0), OTHER: months.map(() => 0) };
  const idx = new Map(months.map((m, i) => [m, i]));
  for (const p of pays) {
    const i = idx.get(p.iso.slice(0, 7));
    if (i === undefined) continue;
    const w = cls === "all" ? (p.art.work ?? 0) : p.tz.filter((t) => t.cls === cls).reduce((a, t) => a + t.amount, 0);
    if (Math.abs(w) < 0.005) continue;
    const k: PayType = p.type in out ? p.type : "OTHER";
    out[k][i] += w;
  }
  return out;
}
