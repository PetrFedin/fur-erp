// Расчёт строки списания ТЗ числами (без Prisma) — для живого пересчёта в форме создания ТЗ
// и для средневзвешенных показателей карточки. Клиентский слой НЕ содержит своих формул цены:
// строка = количество × цена лота (как consumeFromLot), «без НДС» = количество × цена лота без НДС
// (как usageInput/lotUnitCostExclVat), своя ставка НДС строки = сумма с НДС / (1 + ставка),
// надбавка 4% = × COMMISSION_RATE (как lineWith4). Сверяется скриптом scripts/test-tz-calc.ts.
import { COMMISSION_RATE } from "./commission4-const";

export type CalcLot = {
  /** Цена за единицу лота с НДС (RawMaterialLot.unitCost). */
  unitCost: number;
  /** Цена за единицу лота без НДС (lotUnitCostExclVat). */
  unitCostExcl: number;
  /** Ставка НДС лота, % */
  vatRate: number;
};

export type CalcLine = {
  lot: CalcLot;
  qty: number;
  commission4: boolean;
  /** Своя ставка НДС строки, %; null/undefined — как в лоте. */
  vatRate?: number | null;
};

export type LineCalc = {
  /** Без 4%: с НДС / без НДС. */
  baseIncl: number;
  baseExcl: number;
  /** С учётом надбавки 4% (если применима к строке): с НДС / без НДС. */
  incl4: number;
  excl4: number;
  /** Эффективная ставка НДС строки, % */
  vat: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function lineCalc(l: CalcLine): LineCalc {
  const qty = Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 0;
  const baseIncl = r2(l.lot.unitCost * qty);
  const own = l.vatRate != null && Number.isFinite(l.vatRate);
  const baseExcl = own ? baseIncl / (1 + (l.vatRate as number) / 100) : qty * l.lot.unitCostExcl;
  const k = l.commission4 ? 1 + COMMISSION_RATE : 1;
  return { baseIncl, baseExcl, incl4: baseIncl * k, excl4: baseExcl * k, vat: own ? (l.vatRate as number) : l.lot.vatRate };
}

export type Sum = { baseIncl: number; baseExcl: number; incl4: number; excl4: number; qty: number };

export function sumLines(lines: CalcLine[]): Sum {
  const s: Sum = { baseIncl: 0, baseExcl: 0, incl4: 0, excl4: 0, qty: 0 };
  for (const l of lines) {
    const c = lineCalc(l);
    s.baseIncl += c.baseIncl;
    s.baseExcl += c.baseExcl;
    s.incl4 += c.incl4;
    s.excl4 += c.excl4;
    s.qty += Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 0;
  }
  return s;
}

/** Суммы по ставкам НДС (с учётом 4%): «НДС 20%: X ₽, 22%: Y ₽». vat = incl − excl. */
export function vatByRate(lines: CalcLine[], with4: boolean): { rate: number; incl: number; excl: number; vat: number }[] {
  const m = new Map<number, { rate: number; incl: number; excl: number; vat: number }>();
  for (const l of lines) {
    const c = lineCalc(l);
    const row = m.get(c.vat) ?? { rate: c.vat, incl: 0, excl: 0, vat: 0 };
    row.incl += with4 ? c.incl4 : c.baseIncl;
    row.excl += with4 ? c.excl4 : c.baseExcl;
    row.vat = row.incl - row.excl;
    m.set(c.vat, row);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
}

export type DraftTotals = {
  fur: Sum;
  lining: Sum;
  expenses: number;
  work: number;
  /** Всего, с 4% / без 4% (с НДС и без НДС). */
  grandIncl4: number;
  grandIncl0: number;
  grandExcl4: number;
  grandExcl0: number;
  perUnitIncl4: number | null;
  perUnitIncl0: number | null;
  perUnitExcl4: number | null;
  perUnitExcl0: number | null;
  /** Сколько добавляют 4% (с НДС). */
  extra4: number;
  /** Средневзвешенное: цена за единицу и расход на 1 изделие. */
  furAvgPrice: { incl4: number; incl0: number } | null;
  furPerItem: number | null;
  liningAvgPrice: { incl4: number; incl0: number } | null;
  liningPerItem: number | null;
};

/** Итоги ТЗ в той же схеме, что карточка: мех + подкладка + расходы + работа (работа и расходы без 4%). */
export function draftTotals(args: { fur: CalcLine[]; lining: CalcLine[]; expenses: number[]; workPrice: number; qty: number }): DraftTotals {
  const fur = sumLines(args.fur);
  const lining = sumLines(args.lining);
  const expenses = args.expenses.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  const q = Number.isFinite(args.qty) && args.qty > 0 ? args.qty : 0;
  const work = Number.isFinite(args.workPrice) && args.workPrice > 0 ? r2(args.workPrice * q) : 0;
  const grandIncl4 = fur.incl4 + lining.incl4 + expenses + work;
  const grandIncl0 = fur.baseIncl + lining.baseIncl + expenses + work;
  const grandExcl4 = fur.excl4 + lining.excl4 + expenses + work;
  const grandExcl0 = fur.baseExcl + lining.baseExcl + expenses + work;
  const div = (n: number) => (q > 0 ? n / q : null);
  return {
    fur, lining, expenses, work,
    grandIncl4, grandIncl0, grandExcl4, grandExcl0,
    perUnitIncl4: div(grandIncl4), perUnitIncl0: div(grandIncl0), perUnitExcl4: div(grandExcl4), perUnitExcl0: div(grandExcl0),
    extra4: grandIncl4 - grandIncl0,
    furAvgPrice: fur.qty > 0 ? { incl4: fur.incl4 / fur.qty, incl0: fur.baseIncl / fur.qty } : null,
    furPerItem: q > 0 && fur.qty > 0 ? fur.qty / q : null,
    liningAvgPrice: lining.qty > 0 ? { incl4: lining.incl4 / lining.qty, incl0: lining.baseIncl / lining.qty } : null,
    liningPerItem: q > 0 && lining.qty > 0 ? lining.qty / q : null,
  };
}
