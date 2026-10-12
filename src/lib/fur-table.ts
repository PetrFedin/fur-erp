// Единый расчёт таблицы «Мех / Подкладка: куплено → использовано → остаток».
// Чистые функции без базы и без React: их используют /lots (вкладки Мех и Подкладка), Сводка (/dashboard)
// и /analytics/raw (плитки), а scripts/test-fur-table.ts сверяет их с SQL.
//
// Основа — строка-лот (FurLot): одна принятая позиция закупки. Все суммы лота посчитаны на сервере
// (fur-table-server.ts) и лежат парами «с НДС / без НДС»; 4% — отдельной надбавкой к использованному
// (только строки списания с commission4 = true). Здесь они лишь складываются и делятся:
//   • куплено ₽        = Σ(кол-во лота × цена лота за единицу);
//   • использовано ₽   = Σ(списания лота)  [+ 4% в режиме «С 4%»];
//   • остаток ₽        = Σ(остаток лота × цена лота за единицу);
//   • средневзвешенная цена = Σ ₽ ÷ Σ шт (или м) — только отношение сумм, см. weighted.ts.
// 4% к «куплено» и «остаток» не применяется (оно начисляется только при списании в ТЗ).
import { safeRatio } from "./weighted";
import type { UsdSource } from "./lot-hammer";
import { COMMISSION_RATE } from "./commission4-const";

export type FurKind = "fur" | "lining";
export type VatKind = "incl" | "excl";
export type C4Kind = "on" | "off";
export type FlowMode = { vat: VatKind; c4: C4Kind };

export const NO_AUCTION = "__none";
export const NOT_SET = "Не указан";

/** Списание лота в одно ТЗ: количество и суммы (с НДС / без НДС, 4% — надбавка только по строкам с commission4). */
export type FurLotUsage = {
  orderId: string; number: string; qty: number;
  incl: number; excl: number; extraIncl: number; extraExcl: number;
};

export type FurLot = {
  id: string;
  kind: FurKind;
  /** Вид меха (канонический: «Лиса красная» → «Лиса») или номер/название ткани подкладки. */
  item: string;
  /** Название материала в справочнике как есть («Лиса красная»). */
  materialName: string;
  color: string;
  /** Размер лота по документам (RawMaterialLot.sizeGrade, «XXL, XL»); не указан — NOT_SET. */
  size: string;
  /** Размеры лота списком (lotSizes(sizeGrade)); пусто — размер в документах не указан. Лот с несколькими размерами попадает под каждый. */
  sizes: string[];
  /** Признаки меха лота (название из справочника /settings/fur-attrs: «Седина 3», «Дикий»…); пусто — признаков нет. Лот с несколькими признаками попадает под каждый. */
  attrs: string[];
  /** Полное название партии закупки (ключ фильтра) или NO_AUCTION. */
  auction: string;
  auctionLabel: string;
  year: number;
  lotNumber: string;
  grade: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
  supplier: string | null;
  recv: number;
  used: number;
  rem: number;
  recvIncl: number;
  recvExcl: number;
  usedIncl: number;
  usedExcl: number;
  /** Надбавка 4% к использованному (с НДС / без НДС) — только по строкам с commission4. */
  usedExtraIncl: number;
  usedExtraExcl: number;
  remIncl: number;
  remExcl: number;
  /** Закупка в валюте: Σ количество и Σ сумма по позициям (только для лотов с закупкой в USD). */
  /** Ставка НДС лота, % (фильтр «Ставка НДС» на Сводке). */
  vatRate: number;
  /** Закупочная цена шкуры в USD за единицу, если она названа в документах лота (lotUsdPrice); иначе null. */
  usdPrice: number | null;
  /** Откуда цена в USD: direct | eur×rate | rub÷rate | calc | none (lotUsdPrice). */
  usdSource: UsdSource;
  /** Закупка в валюте: Σ количество и Σ сумма «куплено» по лотам с ценой в USD. */
  usdQty: number;
  usdSubtotal: number;
  /** То же для использованного и остатка (только лоты с ценой в USD). */
  usdUsedQty: number;
  usdUsedSubtotal: number;
  usdRemQty: number;
  usdRemSubtotal: number;
  /** «Куплено» шт. по источнику цены в USD (одно из четырёх равно recv, остальные 0). */
  usdQtyDirect: number;
  usdQtyEur: number;
  usdQtyRub: number;
  usdQtyCalc: number;
  usages: FurLotUsage[];
  /** Статус закупки лота: RECEIVED (принята на склад — лот создан), DRAFT (заказано, не получено), CANCELLED. Нет значения — RECEIVED. */
  purchaseStatus?: "RECEIVED" | "DRAFT" | "CANCELLED";
  /** Дата заказа закупки (yyyy-mm-dd) — для фильтра «Дата с / по»; у строк-заглушек нет. */
  orderDate?: string;
  /** Оплачено и к оплате по лоту, ₽ с НДС: доля оплат и долга аукциона пропорционально стоимости лота (как в таблице «по сырью» Главной). Проставляет страница «Сырьё»; нет — фильтр «Оплата» не показывается. */
  paid?: number;
  due?: number;
  /** Строка-заглушка «заказано, не получено»: цена в $ из расчёта ПОЗИЦИЙ закупки (costPlan) — шт. и Σ $. В потоки/плитки не входит; показывается у вида меха без лотов с $ (рысь), как в окне «Цена по видам сырья» на Главной. */
  usdPlanQty?: number;
  usdPlanSubtotal?: number;
  /** Молоток лота, ₽ за шкуру (без / с НДС) и откуда взят (lotHammer); нет цены молотка в расчёте — null. */
  hammerExcl: number | null;
  hammerIncl: number | null;
  hammerSource: string | null;
  /** Для средневзвешенного молотка: шт. лота с молотком и Σ шт. × молоток (без НДС / с НДС). Нет молотка — 0. */
  hamQty: number;
  hamSubExcl: number;
  hamSubIncl: number;
};

// ───────────────────────────── суммы ─────────────────────────────

export type Flow = {
  lots: number;
  recv: number;
  used: number;
  rem: number;
  recvIncl: number;
  recvExcl: number;
  usedIncl: number;
  usedExcl: number;
  usedExtraIncl: number;
  usedExtraExcl: number;
  remIncl: number;
  remExcl: number;
  usdQty: number;
  usdSubtotal: number;
  usdUsedQty: number;
  usdUsedSubtotal: number;
  usdRemQty: number;
  usdRemSubtotal: number;
  /** Сколько шт. «куплено» с ценой в USD — по источникам цены (в сумме = usdQty). */
  usdQtyDirect: number;
  usdQtyEur: number;
  usdQtyRub: number;
  usdQtyCalc: number;
  /** Молоток: шт. лотов с молотком и Σ шт. × ₽ молотка (без НДС / с НДС). */
  hamQty: number;
  hamSubExcl: number;
  hamSubIncl: number;
  /** Сколько лотов с молотком. */
  hamLots: number;
};

export const emptyFlow = (): Flow => ({
  lots: 0, recv: 0, used: 0, rem: 0, recvIncl: 0, recvExcl: 0, usedIncl: 0, usedExcl: 0,
  usedExtraIncl: 0, usedExtraExcl: 0, remIncl: 0, remExcl: 0, usdQty: 0, usdSubtotal: 0,
  usdUsedQty: 0, usdUsedSubtotal: 0, usdRemQty: 0, usdRemSubtotal: 0,
  usdQtyDirect: 0, usdQtyEur: 0, usdQtyRub: 0, usdQtyCalc: 0,
  hamQty: 0, hamSubExcl: 0, hamSubIncl: 0, hamLots: 0,
});

/** Числовая часть лота — всё, что нужно для сумм (общая для строки таблицы и лота аналитики сырья). */
export type FlowLot = Pick<FurLot, "recv" | "used" | "rem" | "recvIncl" | "recvExcl" | "usedIncl" | "usedExcl" | "usedExtraIncl" | "usedExtraExcl" | "remIncl" | "remExcl" | "usdQty" | "usdSubtotal" | "usdUsedQty" | "usdUsedSubtotal" | "usdRemQty" | "usdRemSubtotal" | "usdQtyDirect" | "usdQtyEur" | "usdQtyRub" | "usdQtyCalc" | "hamQty" | "hamSubExcl" | "hamSubIncl">;

export function addLotToFlow(f: Flow, l: FlowLot): Flow {
  f.lots += 1;
  f.recv += l.recv; f.used += l.used; f.rem += l.rem;
  f.recvIncl += l.recvIncl; f.recvExcl += l.recvExcl;
  f.usedIncl += l.usedIncl; f.usedExcl += l.usedExcl;
  f.usedExtraIncl += l.usedExtraIncl; f.usedExtraExcl += l.usedExtraExcl;
  f.remIncl += l.remIncl; f.remExcl += l.remExcl;
  f.usdQty += l.usdQty; f.usdSubtotal += l.usdSubtotal;
  f.usdUsedQty += l.usdUsedQty; f.usdUsedSubtotal += l.usdUsedSubtotal;
  f.usdRemQty += l.usdRemQty; f.usdRemSubtotal += l.usdRemSubtotal;
  f.usdQtyDirect += l.usdQtyDirect; f.usdQtyEur += l.usdQtyEur; f.usdQtyRub += l.usdQtyRub; f.usdQtyCalc += l.usdQtyCalc;
  f.hamLots += l.hamQty > 0 ? 1 : 0; f.hamQty += l.hamQty; f.hamSubExcl += l.hamSubExcl; f.hamSubIncl += l.hamSubIncl;
  return f;
}

export function flowOf(lots: Iterable<FlowLot>): Flow {
  const f = emptyFlow();
  for (const l of lots) addLotToFlow(f, l);
  return f;
}

export function mergeFlows(flows: Iterable<Flow>): Flow {
  const t = emptyFlow();
  for (const f of flows) {
    (Object.keys(t) as (keyof Flow)[]).forEach((k) => { t[k] += f[k]; });
  }
  return t;
}

/** До копеек (сумма уже собрана — погрешность плавающей точки не копится). */
export const round2 = (v: number) => Math.round(v * 100 + (v < 0 ? -1e-7 : 1e-7)) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type FlowFigures = {
  lots: number;
  recvQty: number;
  recvValue: number;
  /** Средневзвешенная цена закупки купленного: Σ ₽ ÷ Σ шт. */
  recvAvg: number | null;
  usedQty: number;
  /** Использовано ₽ в выбранном режиме 4% (с 4% — к строкам, где оно применяется). */
  usedValue: number;
  /** То же в противоположном режиме 4% (для подписи «без 4%: …»). */
  usedValueOther: number;
  usedAvg: number | null;
  remQty: number;
  remValue: number;
  remAvg: number | null;
  /** Средняя цена закупки в валюте (USD за шт.): Σ сумма ÷ Σ кол-во по лотам с ценой в USD (только они). */
  usdAvg: number | null;
  /** Сколько из купленного шт. приходится на лоты с ценой в USD (покрытие usdAvg). */
  usdQty: number;
  /** То же «по USD-лотам» для использованного и остатка: количество и средняя цена $/шт. */
  usdUsedQty: number;
  usdUsedAvg: number | null;
  usdRemQty: number;
  usdRemAvg: number | null;
  /** Из usdQty: по источникам цены в USD (шт.). */
  usdBySource: { direct: number; eur: number; rub: number; calc: number };
  /** Средневзвешенный молоток, ₽/шт. в выбранном режиме НДС: по лотам, у которых молоток есть в расчёте (только они); нет ни у одного — null. */
  hammerAvg: number | null;
  /** Сколько из купленного шт. приходится на лоты с молотком (покрытие hammerAvg). */
  hammerQty: number;
  /** Лотов с молотком. */
  hammerLots: number;
};

export function figures(f: Flow, mode: FlowMode): FlowFigures {
  const excl = mode.vat === "excl";
  const recvValue = round2(excl ? f.recvExcl : f.recvIncl);
  const usedBase = excl ? f.usedExcl : f.usedIncl;
  const usedExtra = excl ? f.usedExtraExcl : f.usedExtraIncl;
  const usedValue = round2(mode.c4 === "on" ? usedBase + usedExtra : usedBase);
  const usedValueOther = round2(mode.c4 === "on" ? usedBase : usedBase + usedExtra);
  const remValue = round2(excl ? f.remExcl : f.remIncl);
  const recvQty = round3(f.recv);
  const usedQty = round3(f.used);
  const remQty = round3(f.rem);
  return {
    lots: f.lots,
    recvQty, recvValue, recvAvg: safeRatio(recvValue, recvQty),
    usedQty, usedValue, usedValueOther, usedAvg: safeRatio(usedValue, usedQty),
    remQty, remValue, remAvg: safeRatio(remValue, remQty),
    usdAvg: safeRatio(f.usdSubtotal, f.usdQty),
    usdQty: round3(f.usdQty),
    usdUsedQty: round3(f.usdUsedQty), usdUsedAvg: safeRatio(f.usdUsedSubtotal, f.usdUsedQty),
    usdRemQty: round3(f.usdRemQty), usdRemAvg: safeRatio(f.usdRemSubtotal, f.usdRemQty),
    usdBySource: { direct: round3(f.usdQtyDirect), eur: round3(f.usdQtyEur), rub: round3(f.usdQtyRub), calc: round3(f.usdQtyCalc) },
    hammerAvg: safeRatio(excl ? f.hamSubExcl : f.hamSubIncl, f.hamQty),
    hammerQty: round3(f.hamQty),
    hammerLots: f.hamLots,
  };
}

/** Внутренняя сверка потока: куплено − использовано = остаток (шт и ₽ без 4%). Пустой список — всё сходится. */
export function flowIssues(f: Flow, tolQty = 0.0005, tolMoney = 0.5): string[] {
  const out: string[] = [];
  if (Math.abs(f.recv - f.used - f.rem) > tolQty) out.push(`шт: куплено ${round3(f.recv)} − использовано ${round3(f.used)} ≠ остаток ${round3(f.rem)}`);
  if (Math.abs(f.recvIncl - f.usedIncl - f.remIncl) > tolMoney) out.push(`₽ с НДС: ${round2(f.recvIncl)} − ${round2(f.usedIncl)} ≠ ${round2(f.remIncl)}`);
  if (Math.abs(f.recvExcl - f.usedExcl - f.remExcl) > tolMoney) out.push(`₽ без НДС: ${round2(f.recvExcl)} − ${round2(f.usedExcl)} ≠ ${round2(f.remExcl)}`);
  return out;
}

// ───────────────────────────── фильтры ─────────────────────────────

export type FilterKey = "item" | "year" | "color" | "size" | "attr" | "auction" | "rest" | "supplier" | "status" | "pay" | "usage" | "rate";
export type FurFilters = Record<FilterKey, string[]>;
export const FILTER_KEYS: FilterKey[] = ["item", "year", "color", "size", "attr", "auction", "rest", "supplier", "status", "pay", "usage", "rate"];
export const emptyFilters = (): FurFilters => ({ item: [], year: [], color: [], size: [], attr: [], auction: [], rest: [], supplier: [], status: [], pay: [], usage: [], rate: [] });

/** Служебное значение фильтра «Поставщик»: у строки нет поставщика (заказано без закупки, шкуры подрядчика). */
export const NO_SUPPLIER = "none";

/** Служебное значение фильтра «Признак меха»: у лота нет признаков. */
export const NO_ATTR = "none";
export const hasFilters = (f: FurFilters) => FILTER_KEYS.some((k) => f[k].length > 0);

export const REST_LABELS: Record<string, string> = { with: "С остатком", zero: "Исчерпан" };
export const STATUS_LABELS: Record<string, string> = { RECEIVED: "Принята на склад", DRAFT: "Черновик (заказано, не получено)", CANCELLED: "Отменена" };
export const PAY_LABELS: Record<string, string> = { paid: "Оплачено", partial: "Оплачено частично", unpaid: "Не оплачено" };
export const USAGE_LABELS: Record<string, string> = { used: "Использован в ТЗ", unused: "Не использован" };
const FIXED_ORDER: Partial<Record<FilterKey, string[]>> = { status: ["RECEIVED", "DRAFT", "CANCELLED"], pay: ["paid", "partial", "unpaid"], usage: ["used", "unused"] };

/** Оплата лота: «Оплачено» — долга нет, «Не оплачено» — оплат нет, иначе «Частично». Без данных об оплате (paid/due не заданы) — null. */
export function payState(l: Pick<FurLot, "paid" | "due">): "paid" | "partial" | "unpaid" | null {
  if (l.paid == null || l.due == null) return null;
  if (l.due < 0.5) return "paid";
  if (l.paid < 0.5) return "unpaid";
  return "partial";
}

export function lotValue(l: FurLot, key: FilterKey): string {
  switch (key) {
    case "item": return l.item;
    case "year": return String(l.year);
    case "color": return l.color;
    case "size": return l.size;
    case "attr": return l.attrs[0] ?? NO_ATTR;
    case "auction": return l.auction;
    case "rest": return l.rem > 0 ? "with" : "zero";
    case "supplier": return l.supplier?.trim() || NO_SUPPLIER;
    case "status": return l.purchaseStatus ?? "RECEIVED";
    case "pay": return payState(l) ?? "paid";
    case "usage": return l.used > 0 || l.usedIncl > 0 ? "used" : "unused";
    case "rate": return String(l.vatRate);
  }
}

/** Значения лота для фильтра: у размера их может быть несколько (sizeGrade «XXL,XL» — под XXL и под XL); нет размера — NOT_SET. */
export function lotValues(l: FurLot, key: FilterKey): string[] {
  if (key === "size") return l.sizes.length > 0 ? l.sizes : [NOT_SET];
  if (key === "attr") return l.attrs.length > 0 ? l.attrs : [NO_ATTR];
  return [lotValue(l, key)];
}

/** Лоты, подходящие под фильтры (пустой список значений фильтра = «все»). skip — не применять один из фильтров. */
export function filterLots(lots: FurLot[], filters: FurFilters, skip?: FilterKey): FurLot[] {
  const active = FILTER_KEYS.filter((k) => k !== skip && filters[k].length > 0);
  if (active.length === 0) return lots;
  const sets = active.map((k) => [k, new Set(filters[k])] as const);
  return lots.filter((l) => sets.every(([k, s]) => lotValues(l, k).some((v) => s.has(v))));
}

export type FilterOption = { value: string; label: string; count: number };

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

/**
 * Варианты фильтра: значения среди лотов, подходящих под ОСТАЛЬНЫЕ фильтры (каскад), со счётчиком лотов.
 * Уже выбранные значения, которых сейчас нет среди лотов, остаются в списке со счётчиком 0 — чтобы их можно было снять.
 */
export function filterOptions(lots: FurLot[], filters: FurFilters, key: FilterKey): FilterOption[] {
  const base = filterLots(lots, filters, key);
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const l of base) {
    for (const v of lotValues(l, key)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
      if (!labels.has(v)) labels.set(v, labelOf(l, key, v));
    }
  }
  for (const v of filters[key]) {
    if (!counts.has(v)) {
      counts.set(v, 0);
      const sample = lots.find((l) => lotValues(l, key).includes(v));
      labels.set(v, sample ? labelOf(sample, key, v) : v === NO_AUCTION ? "Без аукциона" : REST_LABELS[v] ?? STATUS_LABELS[v] ?? PAY_LABELS[v] ?? USAGE_LABELS[v] ?? v);
    }
  }
  const out = Array.from(counts, ([value, count]) => ({ value, label: labels.get(value) ?? value, count }));
  if (key === "year") out.sort((a, b) => Number(b.value) - Number(a.value));
  else if (key === "rest") out.sort((a, b) => (a.value === "with" ? -1 : 1) - (b.value === "with" ? -1 : 1));
  else if (FIXED_ORDER[key]) out.sort((a, b) => FIXED_ORDER[key]!.indexOf(a.value) - FIXED_ORDER[key]!.indexOf(b.value));
  else if (key === "rate") out.sort((a, b) => Number(a.value) - Number(b.value));
  // «не указан в документах» — отдельной строкой в конце списка (с числом лотов).
  else out.sort((a, b) => Number(a.value === NOT_SET || a.value === NO_ATTR) - Number(b.value === NOT_SET || b.value === NO_ATTR) || collator.compare(a.label, b.label));
  return out;
}

function labelOf(l: FurLot, key: FilterKey, v: string): string {
  if (key === "auction") return l.auctionLabel;
  if (key === "rest") return REST_LABELS[v] ?? v;
  if (key === "status") return STATUS_LABELS[v] ?? v;
  if (key === "pay") return PAY_LABELS[v] ?? v;
  if (key === "usage") return USAGE_LABELS[v] ?? v;
  if (key === "rate") return `${v}%`;
  if (key === "supplier" && v === NO_SUPPLIER) return "Без поставщика";
  if (v === NO_ATTR && key === "attr") return "Без признака";
  if (v === NOT_SET && key === "size") return "Размер не указан в документах";
  if (v === NOT_SET && key === "color") return "Цвет не указан в документах";
  return v;
}

// ───────────────────────────── таблица ─────────────────────────────

export type TableRow = { key: string; label: string; lots: FurLot[]; flow: Flow; figures: FlowFigures };

export function groupLots(lots: FurLot[], keyOf: (l: FurLot) => string, labelFor?: (l: FurLot) => string): Map<string, { label: string; lots: FurLot[] }> {
  const m = new Map<string, { label: string; lots: FurLot[] }>();
  for (const l of lots) {
    const k = keyOf(l);
    const cur = m.get(k);
    if (cur) cur.lots.push(l);
    else m.set(k, { label: labelFor ? labelFor(l) : k, lots: [l] });
  }
  return m;
}

export function rowsBy(lots: FurLot[], mode: FlowMode, keyOf: (l: FurLot) => string, labelFor?: (l: FurLot) => string): TableRow[] {
  return Array.from(groupLots(lots, keyOf, labelFor), ([key, g]) => {
    const flow = flowOf(g.lots);
    return { key, label: g.label, lots: g.lots, flow, figures: figures(flow, mode) };
  }).sort((a, b) => collator.compare(a.label, b.label));
}

export type FurTable = {
  /** Все строки (виды/ткани) после фильтров. */
  allRows: TableRow[];
  /** Показанные строки: все или только выбранные. */
  rows: TableRow[];
  /** Выбранные (и видимые после фильтров) ключи. */
  selectedKeys: string[];
  /** Тотал: по выбранным строкам, а если ничего не выбрано — по всем показанным. */
  total: Flow;
  totalFigures: FlowFigures;
  totalOf: "selected" | "all";
  /** Лоты по фильтрам (без учёта выбора) — для проверок и подвала. */
  filteredLots: FurLot[];
};

export function buildFurTable(opts: {
  lots: FurLot[];
  filters: FurFilters;
  selected: Iterable<string>;
  onlySelected?: boolean;
  mode: FlowMode;
}): FurTable {
  const filteredLots = filterLots(opts.lots, opts.filters);
  const allRows = rowsBy(filteredLots, opts.mode, (l) => l.item);
  const visible = new Set(allRows.map((r) => r.key));
  const selectedKeys = Array.from(new Set(opts.selected)).filter((k) => visible.has(k));
  const sel = new Set(selectedKeys);
  const rows = opts.onlySelected && sel.size > 0 ? allRows.filter((r) => sel.has(r.key)) : allRows;
  const totalRows = sel.size > 0 ? allRows.filter((r) => sel.has(r.key)) : rows;
  const total = mergeFlows(totalRows.map((r) => r.flow));
  return {
    allRows, rows, selectedKeys, total, totalFigures: figures(total, opts.mode),
    totalOf: sel.size > 0 ? "selected" : "all", filteredLots,
  };
}

// ───────────────────────────── URL ─────────────────────────────

type Q = Record<string, string | string[] | undefined>;

/** Имена параметров URL: у меха `fur`, `pyear` (старые `year`, `py`), `color`, `size`, `batch`, `rest`; у подкладки — то же с префиксом `l` (`lmat`, `lyear`…). */
export function paramNames(kind: FurKind): Record<FilterKey, string[]> {
  return kind === "fur"
    ? { item: ["fur", "kind", "species"], year: ["pyear", "py", "year", "years"], color: ["color"], size: ["size"], attr: ["attr"], auction: ["batch", "auc"], rest: ["rest"], supplier: ["supplier"], status: ["pstatus"], pay: ["pay"], usage: ["usage"], rate: ["rate"] }
    : { item: ["lmat", "lining"], year: ["lyear"], color: ["lcolor"], size: ["lsize"], attr: ["lattr"], auction: ["lbatch"], rest: ["lrest"], supplier: ["lsupplier"], status: ["lpstatus"], pay: ["lpay"], usage: ["lusage"], rate: ["lrate"] };
}

const asList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).flatMap((s) => String(s).split("\u0001")).map((s) => s.trim()).filter(Boolean).slice(0, 60);

export function parseFilters(q: Q, kind: FurKind): FurFilters {
  const names = paramNames(kind);
  const f = emptyFilters();
  for (const k of FILTER_KEYS) {
    const vals: string[] = [];
    for (const n of names[k]) vals.push(...asList(q[n]).map((s) => s.slice(0, 200)));
    f[k] = Array.from(new Set(vals));
  }
  f.rest = f.rest.filter((v) => v === "with" || v === "zero");
  // Фильтры по статусу закупки и оплате убраны из интерфейса: старые параметры адреса игнорируем.
  f.status = [];
  f.pay = [];
  f.supplier = []; // фильтр «Поставщик» убран из интерфейса (поставщик один)
  f.usage = f.usage.filter((v) => v in USAGE_LABELS);
  f.rate = []; // фильтр «Ставка НДС» убран из интерфейса: старый параметр адреса игнорируем
  f.year = f.year.filter((v) => /^\d{4}$/.test(v));
  return f;
}

/** Параметры URL по фильтрам (повтор ключа: fur=a&fur=b). Пустой фильтр — параметра нет. */
export function filtersToEntries(f: FurFilters, kind: FurKind): Array<[string, string]> {
  const names = paramNames(kind);
  const out: Array<[string, string]> = [];
  for (const k of FILTER_KEYS) for (const v of f[k]) out.push([names[k][0], v]);
  return out;
}

/** Все имена параметров этого фильтра (с псевдонимами) — чтобы стереть их из URL перед записью. */
export function allParamNames(kind: FurKind): string[] {
  return Object.values(paramNames(kind)).flat();
}

export const FOUR_PERCENT = COMMISSION_RATE;

/**
 * Цена в $ вида меха без лотов с ценой в $ (рысь: закупка заказана, лотов нет) — по расчёту позиций закупки; у вида с лотами остаётся цена по лотам
 * (как rawTable.usd на Главной). Возвращает среднюю $ за шт. или null. Итоговые строки и плитки её не включают.
 */
export function planUsdAvg(lots: FurLot[], flow: Flow): number | null {
  if (flow.usdQty > 0) return null;
  let q = 0, sum = 0;
  for (const l of lots) { q += l.usdPlanQty ?? 0; sum += l.usdPlanSubtotal ?? 0; }
  return q > 0 ? sum / q : null;
}
