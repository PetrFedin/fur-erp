// Показатели артикула из тех же ТЗ с составом (DrillOrder), что на Главной: чистые функции без базы и React.
// Режим «С 4%» в системе всегда включён, поэтому i/e строки уже с надбавкой, а «без 4%» = i − ci (доля 4% в строке).
// Формул цены здесь нет: суммы по ТЗ берёт sumOrders (orders-sum), средневзвешенное — сумма по строкам ÷ количество (как cost-summary ТЗ).
import { isRepair, sumOrders, sumTotal } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { furKindsOfOrder } from "@/lib/order-fur";

export type Pair = { incl: number; excl: number };
const z = (): Pair => ({ incl: 0, excl: 0 });

export type FurKindStat = {
  fur: string;
  /** Шкур, шт. */
  qty: number;
  on: Pair;
  off: Pair;
};

export type ArticleMetrics = {
  /** Уникальные ТЗ (по номеру ТЗ из документа). */
  orders: number;
  /** Позиции (записи). */
  items: number;
  /** Произведено, шт. (все ТЗ без отменённых и ремонта). */
  qty: number;
  /** Мех по строкам списания: шкур и сумма (с 4% / без 4%). */
  fur: { qty: number; on: Pair; off: Pair };
  /** По виду меха — для средневзвешенной цены шкуры и расхода на изделие. */
  furKinds: FurKindStat[];
  lining: { qty: number; on: Pair; off: Pair };
  work: number;
  /** Себестоимость итого (мех + шкуры подрядчика + подкладка + 4% + расходы + работа): с 4% и без 4%. */
  total: { on: Pair; off: Pair };
  /** На 1 изделие. */
  unit: { on: Pair; off: Pair } | null;
  /** Добавка 4%, с НДС. */
  extra4: number;
  /** Суммы строк мех+подкладка по ставкам НДС (с 4%): rate %, incl, vat. */
  vatRows: { rate: number; incl: number; vat: number }[];
  /** Ставки НДС строками для колонки списка: «20%, 22%». */
  vatRates: number[];
  /** Основной вид меха — на который списано больше всего. */
  primaryFur: string | null;
  furNames: string[];
};

/** Ставка НДС строки по паре «с НДС / без НДС» (стандартные 0/10/20/22 → целое, иначе до десятых). */
export function rateOf(incl: number, excl: number): number | null {
  if (!(excl > 0) || !(incl > 0)) return null;
  const r = (incl / excl - 1) * 100;
  const rounded = Math.round(r);
  return Math.abs(r - rounded) < 0.25 ? rounded : Math.round(r * 10) / 10;
}

export function articleMetrics(os: DrillOrder[]): ArticleMetrics {
  const list = os.filter((o) => !isRepair(o));
  const sI = sumOrders(list, "incl");
  const sE = sumOrders(list, "excl");
  const qty = sI.qty;
  const kinds = new Map<string, FurKindStat>();
  const fur = { qty: 0, on: z(), off: z() };
  const lining = { qty: 0, on: z(), off: z() };
  const vat = new Map<number, { incl: number; excl: number }>();
  for (const o of list) {
    for (const l of o.lines) {
      const bucket = l.k === "f" ? fur : lining;
      bucket.qty += l.q;
      bucket.on.incl += l.i;
      bucket.on.excl += l.e;
      bucket.off.incl += l.i - l.ci;
      bucket.off.excl += l.e - l.ce;
      if (l.k === "f") {
        const key = l.fu || l.n || "Мех";
        const k = kinds.get(key) ?? { fur: key, qty: 0, on: z(), off: z() };
        k.qty += l.q;
        k.on.incl += l.i;
        k.on.excl += l.e;
        k.off.incl += l.i - l.ci;
        k.off.excl += l.e - l.ce;
        kinds.set(key, k);
      }
      const r = rateOf(l.i, l.e);
      if (r != null) {
        const v = vat.get(r) ?? { incl: 0, excl: 0 };
        v.incl += l.i;
        v.excl += l.e;
        vat.set(r, v);
      }
    }
  }
  // Вид меха самого ТЗ (order-fur.ts): ТЗ без списаний меха (например, бобр подрядчика) тоже даёт строку вида — иначе у артикула «мех: —».
  for (const o of list) for (const key of furKindsOfOrder(o.fur)) if (!kinds.has(key)) kinds.set(key, { fur: key, qty: 0, on: z(), off: z() });
  const totIncl = sumTotal(sI);
  const totExcl = sumTotal(sE);
  const total = { on: { incl: totIncl, excl: totExcl }, off: { incl: totIncl - sI.c4, excl: totExcl - sE.c4 } };
  const furKinds = Array.from(kinds.values()).sort((a, b) => b.on.incl - a.on.incl);
  const vatRows = Array.from(vat, ([rate, v]) => ({ rate, incl: v.incl, vat: v.incl - v.excl })).sort((a, b) => a.rate - b.rate);
  return {
    orders: sI.orders,
    items: list.length,
    qty,
    fur,
    furKinds,
    lining,
    work: sI.work,
    total,
    unit: qty > 0 ? { on: { incl: total.on.incl / qty, excl: total.on.excl / qty }, off: { incl: total.off.incl / qty, excl: total.off.excl / qty } } : null,
    extra4: sI.c4,
    vatRows,
    vatRates: vatRows.map((v) => v.rate),
    primaryFur: furKinds[0]?.fur ?? null,
    furNames: furKinds.map((k) => k.fur),
  };
}
