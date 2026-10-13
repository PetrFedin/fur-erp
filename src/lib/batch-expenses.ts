/**
 * «Расходы партии» в окне «Новая партия закупки»: общие суммы (транспорт, таможня, выделка, сборы аукциона, брокер,
 * комиссия, упаковка…) раскладываются на строки лотов в те же столбцы расчётного листа (fee / dressing / transport /
 * broker / transit), по которым itemsOf() строит costPlan. Новых формул себестоимости здесь нет: итог считает
 * computeCostPlan из cost-plan.ts — тот же код, что у «Править расчёт» и серверного предпросмотра.
 * Чистые функции без базы — работают в браузере.
 */
import { computeCostPlan, DEFAULT_VAT, roundQty } from "@/lib/cost-plan";
import { num, type IntakeRow } from "@/lib/batch-intake";

export type FeeMode = "pct" | "rub";
export type SpreadBase = "qty" | "value";

/** Общие расходы партии, как их вводит человек (строки: пустая = не задано). */
export type BatchExpenses = {
  /** Сборы аукциона (аукционный, маркетинговый, доставка): % от стоимости товара либо сумма в ₽ с НДС 22% нет — сумма без НДС. */
  fee: string;
  feeMode: FeeMode;
  /** Брокерский: % либо ₽ за всю партию. */
  broker: string;
  brokerMode: FeeMode;
  /** Выделка за всю партию, ₽ с НДС 22%. */
  dressing: string;
  /** Транспорт за всю партию, ₽. */
  transport: string;
  /** Таможня и таможенные платежи, ₽ (в расчётном листе — в строке «Транспорт»). */
  customs: string;
  /** Комиссия за транзит денег, ₽. */
  transit: string;
  /** Упаковка и прочее, ₽ (в расчётном листе — в строке «Транспорт»). */
  other: string;
  /** Как делить ₽-суммы: поровну на шкуру или пропорционально стоимости товара. */
  base: SpreadBase;
};

export const EMPTY_EXPENSES: BatchExpenses = { fee: "", feeMode: "pct", broker: "", brokerMode: "pct", dressing: "", transport: "", customs: "", transit: "", other: "", base: "qty" };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const fmtNum = (n: number) => String(n).replace(".", ",");

type Valid = { r: IntakeRow; qty: number; price: number };

function validRows(rows: IntakeRow[]): Valid[] {
  const out: Valid[] = [];
  for (const r of rows) {
    const qty = num(r.qty), price = num(r.price);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0) out.push({ r, qty, price });
  }
  return out;
}

export function hasAnyExpense(e: BatchExpenses): boolean {
  return [e.fee, e.broker, e.dressing, e.transport, e.customs, e.transit, e.other].some((v) => v.trim() !== "");
}

/** Ошибки ввода расходов (понятным текстом). Пустой список — можно применять. */
export function expenseProblems(e: BatchExpenses): string[] {
  const out: string[] = [];
  const chk = (label: string, v: string, pct = false) => {
    if (v.trim() === "") return;
    const n = num(v);
    if (!Number.isFinite(n)) out.push(`${label}: «${v}» — не число`);
    else if (n < 0) out.push(`${label}: сумма не может быть отрицательной`);
    else if (pct && n > 100) out.push(`${label}: процент должен быть от 0 до 100`);
  };
  chk("Сборы аукциона", e.fee, e.feeMode === "pct");
  chk("Брокерский", e.broker, e.brokerMode === "pct");
  chk("Выделка", e.dressing);
  chk("Транспорт", e.transport);
  chk("Таможня", e.customs);
  chk("Комиссия за транзит", e.transit);
  chk("Упаковка и прочее", e.other);
  return out;
}

export type SpreadResult = {
  /** Что записать в строки: ключ — IntakeRow.n. */
  patch: Map<number, Pick<IntakeRow, "fee" | "dressing" | "transport" | "broker" | "transit">>;
  /** Процентные столбцы: после применения «сбор» и «брокерский» хранятся в процентах. */
  pct: Partial<Record<"fee" | "broker", boolean>>;
  /** Строк получили расходы. */
  rows: number;
  /** Строк пропущено (нет количества или цены). */
  skipped: number;
  /** Сумма по строкам после округления до 4 знаков на шкуру — для сверки с введённым. */
  spread: { dressing: number; transport: number; transit: number };
};

/**
 * Раскладка общих расходов на строки. ₽-суммы (выделка, транспорт+таможня+прочее, транзит) делятся на шкуры поровну
 * либо пропорционально стоимости товара лота; % и ₽ сборов/брокерского переводятся в процент от стоимости товара.
 */
export function spreadExpenses(rows: IntakeRow[], rate: number, e: BatchExpenses): SpreadResult {
  const valid = validRows(rows);
  const patch: SpreadResult["patch"] = new Map();
  const totalQty = valid.reduce((s, v) => s + v.qty, 0);
  const totalGoods = valid.reduce((s, v) => s + v.qty * v.price * rate, 0);
  const val = (s: string) => (s.trim() === "" ? 0 : Math.max(0, num(s) || 0));
  const transportAll = val(e.transport) + val(e.customs) + val(e.other);
  const unitOf = (total: number, v: Valid): number => {
    if (total <= 0) return 0;
    if (e.base === "value" && totalGoods > 0) return r4((total * (v.price * rate)) / totalGoods);
    return totalQty > 0 ? r4(total / totalQty) : 0;
  };
  const pctOf = (raw: string, mode: FeeMode): number | null => {
    if (raw.trim() === "") return null;
    const n = val(raw);
    if (mode === "pct") return r6(n);
    return totalGoods > 0 ? r6((n / totalGoods) * 100) : 0;
  };
  const feePct = pctOf(e.fee, e.feeMode);
  const brokerPct = pctOf(e.broker, e.brokerMode);
  const spread = { dressing: 0, transport: 0, transit: 0 };
  for (const v of valid) {
    const dressing = unitOf(val(e.dressing), v);
    const transport = unitOf(transportAll, v);
    const transit = unitOf(val(e.transit), v);
    spread.dressing += dressing * v.qty;
    spread.transport += transport * v.qty;
    spread.transit += transit * v.qty;
    patch.set(v.r.n, {
      fee: feePct === null ? v.r.fee : fmtNum(feePct),
      broker: brokerPct === null ? v.r.broker : fmtNum(brokerPct),
      dressing: e.dressing.trim() === "" ? v.r.dressing : fmtNum(dressing),
      transport: e.transport.trim() === "" && e.customs.trim() === "" && e.other.trim() === "" ? v.r.transport : fmtNum(transport),
      transit: e.transit.trim() === "" ? v.r.transit : fmtNum(transit),
    });
  }
  return {
    patch,
    pct: { ...(feePct !== null ? { fee: true } : {}), ...(brokerPct !== null ? { broker: true } : {}) },
    rows: valid.length,
    skipped: rows.length - valid.length,
    spread: { dressing: Math.round(spread.dressing * 100) / 100, transport: Math.round(spread.transport * 100) / 100, transit: Math.round(spread.transit * 100) / 100 },
  };
}

// ======================================================================= состав цены

export type Composition = {
  lots: number;
  qty: number;
  /** Товар (молоток × курс), ₽ без НДС. */
  goods: number;
  /** Аукционный сбор, ₽ без НДС. */
  fee: number;
  /** НДС на сбор и на выделку (услуги, 22%) — отдельной строкой не показываем: он внутри «НДС». */
  goodsVat: number;
  feeVat: number;
  dressing: number;
  transport: number;
  broker: number;
  transit: number;
  /** Итого с НДС — Σ computeCostPlan.totalIncl. */
  totalIncl: number;
  totalExcl: number;
  /** Себестоимость за шкуру, ₽ с НДС / без НДС. */
  perUnitIncl: number;
  perUnitExcl: number;
  /** По лотам: номер, мех, шт., себестоимость за шкуру и итого, ₽ с НДС. */
  perLot: { n: number; lot: string; material: string; qty: number; unitIncl: number; totalIncl: number }[];
};

/**
 * Состав цены и «себестоимость за шкуру» по строкам — тот же расчёт, что у itemsOf (проценты/рубли столбцов сбора и брокерского,
 * ставка НДС строки или по умолчанию). Строки без числа/цены пропускаются — их показывает проверка таблицы.
 */
export function compositionOf(
  rows: IntakeRow[],
  ctx: { rate: number; currency: string; vatDefault: number; pct?: Partial<Record<"fee" | "broker", boolean>> },
): Composition {
  const rate = ctx.currency === "RUB" ? 1 : ctx.rate;
  const c: Composition = { lots: 0, qty: 0, goods: 0, fee: 0, goodsVat: 0, feeVat: 0, dressing: 0, transport: 0, broker: 0, transit: 0, totalIncl: 0, totalExcl: 0, perUnitIncl: 0, perUnitExcl: 0, perLot: [] };
  const opt = (s: string) => (s.trim() === "" ? null : (Number.isFinite(num(s)) ? num(s) : null));
  for (const { r, qty, price } of validRows(rows)) {
    const q = roundQty(qty);
    const goods = price * rate;
    const pct = (v: number | null, isPct?: boolean) => (v === null ? 0 : isPct ? v : goods > 0 ? (v / goods) * 100 : 0);
    const vat = r.vat.trim() ? num(r.vat) : ctx.vatDefault;
    const dressing = opt(r.dressing) ?? 0, transport = opt(r.transport) ?? 0, transit = opt(r.transit) ?? 0;
    const cp = computeCostPlan({
      quantity: q, price, rate,
      vat: Number.isFinite(vat) ? vat : DEFAULT_VAT,
      feePct: pct(opt(r.fee), ctx.pct?.fee),
      brokerPct: pct(opt(r.broker), ctx.pct?.broker),
      dressing, transport, transit,
    });
    c.lots += 1;
    c.qty += q;
    c.goods += cp.goods * q;
    c.fee += cp.fee * q;
    c.feeVat += cp.feeVat * q;
    c.goodsVat += cp.goodsVat * q;
    c.dressing += dressing * q;
    c.transport += transport * q;
    c.broker += cp.broker * q;
    c.transit += transit * q;
    c.totalIncl += cp.totalIncl;
    c.totalExcl += cp.totalExcl;
    c.perLot.push({ n: r.n, lot: r.lot, material: r.material, qty: q, unitIncl: cp.unitIncl, totalIncl: cp.totalIncl });
  }
  if (c.qty > 0) {
    c.perUnitIncl = c.totalIncl / c.qty;
    c.perUnitExcl = c.totalExcl / c.qty;
  }
  return c;
}
