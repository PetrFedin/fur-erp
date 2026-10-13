// Расчёт себестоимости лота по формулам расчётного листа (PurchaseItem.costPlan).
// Чистые функции без серверных зависимостей: их использует и форма «Править расчёт»
// (живой пересчёт в браузере), и server action — цифры совпадают по построению.
// Подписи строк costBreakdown — те же, что в scripts/import-sp0926.ts; они
// классифицируются в cost-breakdown-groups.ts.

/** Ставка НДС на сбор аукциона и выделку — фиксированная (как в расчётном листе). */
export const SERVICE_VAT = 0.22;

export type CostPlanInputs = {
  quantity: number;
  /** Цена лота за шт. в валюте закупки ($). */
  price: number;
  /** Курс ЦБ → ₽. */
  rate: number;
  /** % сборов аукциона от стоимости товара (7,35 = 5,5 + 1,25 + 0,6). */
  feePct: number;
  /** Выделка, ₽ с НДС 22%. */
  dressing: number;
  /** Транспорт на выделку и обратно, ₽. */
  transport: number;
  /** Брокерский %, от стоимости товара. */
  brokerPct: number;
  /** Комиссия за транзит денег, ₽. */
  transit: number;
  /** Ставка НДС на товар, %. */
  vat: number;
  /** Ставка НДС на сбор аукциона и выделку, %. По умолчанию 22 (с 01.01.2026); для закупок 2025 года — 20. */
  serviceVatPct?: number;
};

/** Округление «как в БД» (half-up по десятичной записи), без ошибок двоичной дроби вроде 1.005. */
export function roundTo(n: number, digits: number): number {
  if (!Number.isFinite(n)) return n;
  const s = String(n);
  if (s.includes("e")) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  }
  const sign = n < 0 ? -1 : 1;
  return sign * Number(Math.round(Number(`${Math.abs(n)}e${digits}`)) + `e-${digits}`);
}
/** Точность колонок PurchaseItem / Purchase: цена 2 знака, количество 3, НДС 2, курс 6. */
export const roundPrice = (n: number) => roundTo(n, 2);
export const roundQty = (n: number) => roundTo(n, 3);
export const roundVat = (n: number) => roundTo(n, 2);
export const roundRate = (n: number) => roundTo(n, 6);

export const DEFAULT_FEE_PCT = 7.35;
export const DEFAULT_BROKER_PCT = 4.5;
export const DEFAULT_VAT = 22;

export type CostPlanResult = {
  goods: number;
  fee: number;
  feeVat: number;
  goodsVat: number;
  broker: number;
  dressingExcl: number;
  unitIncl: number;
  unitExcl: number;
  materialExcl: number;
  materialVat: number;
  expenseExcl: number;
  expenseVat: number;
  totalIncl: number;
  totalExcl: number;
};

export function computeCostPlan(i: CostPlanInputs): CostPlanResult {
  const svc = i.serviceVatPct != null && Number.isFinite(i.serviceVatPct) ? i.serviceVatPct / 100 : SERVICE_VAT;
  const goods = i.price * i.rate;
  const fee = goods * (i.feePct / 100);
  const feeVat = fee * svc;
  const goodsVat = (goods * i.vat) / 100;
  const broker = goods * (i.brokerPct / 100);
  const dressingExcl = i.dressing / (1 + svc);
  const unitIncl = goods + fee + feeVat + goodsVat + i.dressing + i.transport + broker + i.transit;
  const unitExcl = goods + fee + dressingExcl + i.transport + broker + i.transit;
  return {
    goods,
    fee,
    feeVat,
    goodsVat,
    broker,
    dressingExcl,
    unitIncl,
    unitExcl,
    materialExcl: goods,
    materialVat: goodsVat,
    expenseExcl: unitExcl - goods,
    expenseVat: feeVat + i.dressing - dressingExcl,
    totalIncl: unitIncl * i.quantity,
    totalExcl: unitExcl * i.quantity,
  };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const s6 = (n: number) => String(r6(n));
const pctText = (p: number) => String(r6(p)).replace(".", ",");

/** Введённые параметры, сохраняемые в costPlan.inputs (чтобы смена курса пересчитывала точно). */
export type StoredInputs = {
  feePct: number;
  dressing: number;
  transport: number;
  brokerPct: number;
  transit: number;
  /** Только если не 22 (закупки 2025 года — 20). */
  serviceVatPct?: number;
  /** Части «транспорта» (он хранится суммой): таможня и упаковка — отдельные строки расчёта. */
  customs?: number;
  packing?: number;
};

export type PlanMeta = { furDescription?: unknown; exchangeRateFixed?: unknown };

/** Готовый JSON для PurchaseItem.costPlan (формат совпадает с import-sp0926). */
export function buildCostPlanJson(i: CostPlanInputs, meta: PlanMeta, editedAtIso: string, parts?: { customs?: number; packing?: number }) {
  const c = computeCostPlan(i);
  const svcPct = i.serviceVatPct != null && Number.isFinite(i.serviceVatPct) ? i.serviceVatPct : SERVICE_VAT * 100;
  const customs = Math.max(0, Math.min(parts?.customs ?? 0, i.transport));
  const packing = Math.max(0, Math.min(parts?.packing ?? 0, i.transport - customs));
  const transportOnly = r6(i.transport - customs - packing);
  const items = [
    { label: "Цена за ед., $", value: i.price },
    { label: "Курс ЦБ на дату счёта", value: i.rate },
    { label: "Цена за ед. по курсу, ₽", value: r6(c.goods) },
    { label: `Аукционный сбор, маркетинговый сбор, сбор за доставку (${pctText(i.feePct)}% от цены), ₽`, value: r6(c.fee) },
    { label: "НДС на аукционный сбор, ₽", value: r6(c.feeVat) },
    { label: `НДС ${pctText(i.vat)}% на товар, ₽`, value: r6(c.goodsVat) },
    { label: `Выделка (с НДС ${pctText(svcPct)}%), ₽`, value: i.dressing },
    { label: "Транспорт на выделку и обратно, ₽", value: transportOnly },
    ...(customs ? [{ label: "Таможня и таможенные платежи, ₽", value: customs }] : []),
    ...(packing ? [{ label: "Упаковка и прочее, ₽", value: packing }] : []),
    { label: `Брокерский %, ${pctText(i.brokerPct)}% от цены, ₽`, value: r6(c.broker) },
    ...(i.transit ? [{ label: "Комиссия за транзит денег, ₽", value: i.transit }] : []),
    { label: "Итого себестоимость за единицу, ₽", value: r6(c.unitIncl) },
  ];
  const inputs: StoredInputs = {
    feePct: i.feePct,
    dressing: i.dressing,
    transport: i.transport,
    brokerPct: i.brokerPct,
    transit: i.transit,
    ...(svcPct !== SERVICE_VAT * 100 ? { serviceVatPct: svcPct } : {}),
    ...(customs ? { customs } : {}),
    ...(packing ? { packing } : {}),
  };
  return {
    unitCostInclVat: s6(c.unitIncl),
    materialExclVat: s6(c.materialExcl),
    materialVat: s6(c.materialVat),
    expenseExclVat: s6(c.expenseExcl),
    expenseVat: s6(c.expenseVat),
    inputs,
    manualEditedAt: editedAtIso,
    costBreakdown: {
      furDescription: meta.furDescription ?? null,
      exchangeRateInvoice: String(i.rate),
      exchangeRateFixed: meta.exchangeRateFixed ?? null,
      items,
    },
  };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Параметры лота, выведенные из текущего costPlan: сохранённые inputs, а для
 * расчётов из импорта — по строкам costBreakdown (процент = сумма / стоимость товара).
 * Цена, курс и ставка НДС берутся из позиции и закупки, а не из расчёта.
 */
export function deriveCostPlanInputs(
  costPlan: unknown,
  base: { quantity: number; price: number; rate: number; vat: number },
): CostPlanInputs {
  const c = (costPlan ?? {}) as Record<string, unknown>;
  const goods = base.price * base.rate;
  const stored = c.inputs as Partial<StoredInputs> | undefined;
  const bd = c.costBreakdown as { items?: { label?: unknown; value?: unknown }[] } | undefined;
  const find = (prefix: string) => {
    const it = (Array.isArray(bd?.items) ? bd!.items! : []).find(
      (x) => typeof x.label === "string" && x.label.toLowerCase().startsWith(prefix),
    );
    return it ? num(it.value) : null;
  };
  const pctOf = (sum: number | null) => (sum != null && goods > 0 ? r6((sum / goods) * 100) : null);
  return {
    quantity: base.quantity,
    price: base.price,
    rate: base.rate,
    vat: base.vat,
    feePct: num(stored?.feePct) ?? pctOf(find("аукционный сбор")) ?? DEFAULT_FEE_PCT,
    dressing: num(stored?.dressing) ?? find("выделка") ?? 0,
    transport: num(stored?.transport) ?? find("транспорт на выделку") ?? 0,
    brokerPct: num(stored?.brokerPct) ?? pctOf(find("брокер")) ?? DEFAULT_BROKER_PCT,
    transit: num(stored?.transit) ?? find("комиссия за транзит") ?? 0,
    ...(num(stored?.serviceVatPct) != null ? { serviceVatPct: num(stored?.serviceVatPct)! } : {}),
  };
}
