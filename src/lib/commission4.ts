// Расчёт «с 4%»: надбавка 4% к цене сырья ТЗ. Чистые функции без обращения к БД.
//
// Цена в учёте — с НДС. Надбавка считается от цены БЕЗ НДС, затем НДС
// начисляется обратно: price4 = incl / (1 + vat) × 1.04 × (1 + vat).
// При постоянной ставке НДС это то же самое, что incl × 1.04, но формула
// явная — важно, если ставка у строки отличается.
//
// К каким строкам списания применяется 4% — флаг ProductionMaterialUsage.commission4
// (по умолчанию true: сырьё и подкладка; не применяется к лоскуту ТЗ 75, фондю,
// бобру 97/104, партии 6).

export const COMMISSION_RATE = 0.04;

/** Ставка НДС в долях: 20 → 0.2; 0.2 → 0.2 (значения > 1 считаются процентами). */
export function vatFraction(vatRate: number): number {
  if (!Number.isFinite(vatRate) || vatRate < 0) return 0;
  return vatRate > 1 ? vatRate / 100 : vatRate;
}

/** Цена с НДС → цена с надбавкой 4% (тоже с НДС). */
export function price4(inclVat: number, vatRate: number): number {
  if (!Number.isFinite(inclVat)) return 0;
  const v = vatFraction(vatRate);
  return (inclVat / (1 + v)) * (1 + COMMISSION_RATE) * (1 + v);
}

/** Сколько добавляет надбавка 4% к цене с НДС. */
export function commission4Amount(inclVat: number, vatRate: number): number {
  return price4(inclVat, vatRate) - inclVat;
}

/** Стоимость строки списания: с надбавкой 4%, если она применяется к этой строке. */
export function lineCostWith4(inclVat: number, vatRate: number, commission4Applies: boolean): number {
  return commission4Applies ? price4(inclVat, vatRate) : inclVat;
}

// ───────────────────────── Режим показа «Без 4% / С 4%» ─────────────────────────
//
// Базовая стоимость в БД (unitCost/totalCost списаний) — всегда «без 4%» и не
// меняется. 4% — только расчёт при показе: сервер считает пары incl/excl уже
// с надбавкой и отдаёт их в обычный <Money incl excl> (клиентский API не менялся).
// Надбавка — ТОЛЬКО на сырьё и подкладку (строки списаний); работа и расходы
// не облагаются.

import { Decimal } from "@prisma/client/runtime/library";
import { lotUnitCostExclVat } from "./purchase-totals";
import type { Commission4Mode } from "./commission4-mode";

export type { Commission4Mode } from "./commission4-mode";

const RATE = new Decimal(COMMISSION_RATE);

/** Строка списания в минимальном виде: цена с НДС, цена без НДС и флаг применимости 4%. */
export type Usage4Input = {
  /** Сумма списания с НДС (ProductionMaterialUsage.totalCost). */
  incl: Decimal.Value;
  /** Сумма списания без НДС (quantity × lotUnitCostExclVat). */
  excl: Decimal.Value;
  commission4: boolean;
};

export type Line4 = {
  incl: Decimal;
  excl: Decimal;
  /** Применена ли надбавка (режим «С 4%» и commission4 = true). */
  applied: boolean;
  /** Сколько надбавка добавила (с НДС / без НДС). */
  extraIncl: Decimal;
  extraExcl: Decimal;
};

/**
 * Строка списания в выбранном режиме. С одним уровнем НДС в строке
 * incl/(1+v) × 1.04 × (1+v) = incl × 1.04, поэтому и «с НДС», и «без НДС»
 * просто умножаются на 1,04 — их соотношение (1+v) сохраняется.
 */
export function lineWith4(usage: Usage4Input, mode: Commission4Mode): Line4 {
  const incl = new Decimal(usage.incl);
  const excl = new Decimal(usage.excl);
  const applied = mode === "on" && usage.commission4;
  if (!applied) return { incl, excl, applied: false, extraIncl: new Decimal(0), extraExcl: new Decimal(0) };
  const extraIncl = incl.mul(RATE);
  const extraExcl = excl.mul(RATE);
  return { incl: incl.add(extraIncl), excl: excl.add(extraExcl), applied: true, extraIncl, extraExcl };
}

type UsageForSum = {
  totalCost: Decimal.Value;
  quantity: Decimal.Value;
  commission4: boolean;
  lot: Parameters<typeof lotUnitCostExclVat>[0];
};

/** Приведение строки списания из БД к Usage4Input (incl — totalCost, excl — по лоту). */
export function usageInput(u: UsageForSum): Usage4Input {
  return {
    incl: u.totalCost,
    excl: new Decimal(u.quantity).mul(lotUnitCostExclVat(u.lot)),
    commission4: u.commission4,
  };
}

export type Usages4Sum = { incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal };

/** Сумма списаний с учётом режима: итог (с НДС / без НДС) и сколько добавило 4%. */
export function sumUsagesWith4(usages: UsageForSum[], mode: Commission4Mode): Usages4Sum {
  const acc: Usages4Sum = { incl: new Decimal(0), excl: new Decimal(0), extraIncl: new Decimal(0), extraExcl: new Decimal(0) };
  for (const u of usages) {
    const l = lineWith4(usageInput(u), mode);
    acc.incl = acc.incl.add(l.incl);
    acc.excl = acc.excl.add(l.excl);
    acc.extraIncl = acc.extraIncl.add(l.extraIncl);
    acc.extraExcl = acc.extraExcl.add(l.extraExcl);
  }
  return acc;
}

/** Только надбавка с НДС по списаниям, у которых нет данных лота (batch-stats): totalCost × 4%. */
export function extraInclOnly(usages: { totalCost: Decimal.Value; commission4: boolean }[], mode: Commission4Mode): Decimal {
  if (mode !== "on") return new Decimal(0);
  return usages
    .filter((u) => u.commission4)
    .reduce((s, u) => s.add(new Decimal(u.totalCost).mul(RATE)), new Decimal(0));
}

export const COMMISSION4_HINT =
  "4% — доп. комиссия посредника к сырью и подкладке (договор, расчёты «+4%»); работа не облагается";

/** Подпись режима для заголовков/итогов: « (с 4%)» или пусто. */
export function c4Suffix(mode: Commission4Mode): string {
  return mode === "on" ? " (с 4%)" : "";
}
