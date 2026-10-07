// «Молоток» лота — цена шкуры на аукционе ДО сборов, выделки, транспорта, брокера и комиссий.
// Хранится не отдельным полем, а строкой расчёта лота (RawMaterialLot.costBreakdown, он же копия PurchaseItem.costPlan):
//   • «Стоимость молоток за ед без НДС» (+ «… в т.ч. НДС») — уже в ₽ по курсу лота;
//   • «Цена за ед. (ам. долл.)» × «Курс» — то же, если готовой строки нет;
//   • «Цена за ед. по курсу, ₽» (и «Цена за ед., $») — формат расчётного листа costPlan.
// Нет ни одной из этих строк — молотка нет (лот не считается в среднее молотка).

export type Hammer = {
  /** ₽ за шкуру без НДС. */
  excl: number;
  /** ₽ за шкуру с НДС лота. */
  incl: number;
  /** $ за шкуру, если цена была в долларах. */
  usd: number | null;
  /** Откуда взято (для подсказки). */
  source: "молоток в расчёте лота" | "цена × курс" | "расчётный лист";
};

type Item = { label?: unknown; value?: unknown };

function itemsOf(breakdown: unknown): Item[] {
  const b = breakdown as { items?: unknown } | null | undefined;
  return b && typeof b === "object" && Array.isArray(b.items) ? (b.items as Item[]) : [];
}

function pick(items: Item[], label: string, prefix = false): number | null {
  const low = label.toLowerCase();
  for (const it of items) {
    if (typeof it.label !== "string") continue;
    const l = it.label.trim().toLowerCase();
    if (prefix ? !l.startsWith(low) : l !== low) continue;
    const n = Number(it.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fromItems(items: Item[], vatRate: number): Hammer | null {
  if (items.length === 0) return null;
  const k = 1 + (Number.isFinite(vatRate) ? vatRate : 0) / 100;
  const usd = pick(items, "Цена за ед. (ам. долл.)") ?? pick(items, "Цена за ед., $");
  const direct = pick(items, "Стоимость молоток за ед без НДС");
  if (direct != null && direct > 0) {
    const incl = pick(items, "Стоимость молоток за ед в т.ч. НДС");
    return { excl: direct, incl: incl != null && incl > 0 ? incl : direct * k, usd, source: "молоток в расчёте лота" };
  }
  const rate = pick(items, "Курс") ?? pick(items, "Курс ЦБ на дату счёта");
  if (usd != null && usd > 0 && rate != null && rate > 0) {
    const excl = usd * rate;
    return { excl, incl: excl * k, usd, source: "цена × курс" };
  }
  const plan = pick(items, "Цена за ед. по курсу, ₽");
  if (plan != null && plan > 0) return { excl: plan, incl: plan * k, usd, source: "расчётный лист" };
  return null;
}

/** Молоток лота: из расчёта лота, а если его нет — из расчётного листа позиций закупки (costPlan). */
export function lotHammer(costBreakdown: unknown, vatRate: number, planBreakdowns: unknown[] = []): Hammer | null {
  const own = fromItems(itemsOf(costBreakdown), vatRate);
  if (own) return own;
  for (const p of planBreakdowns) {
    const cp = (p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown;
    const h = fromItems(itemsOf(cp), vatRate);
    if (h) return h;
  }
  return null;
}

/**
 * Закупочная цена шкуры в долларах за единицу (молоток, до сборов) — только если она названа в документах лота:
 * «Цена за ед. (ам. долл.)» в расчёте лота (RawMaterialLot.costBreakdown) или «Цена за ед., $» в расчётном листе позиции закупки.
 * Ничего не пересчитывается по курсу: нет строки — null (у лота нет цены в USD).
 */
export function lotUsdPrice(costBreakdown: unknown, planBreakdowns: unknown[] = []): number | null {
  const own = itemsOf(costBreakdown);
  const fromOwn = pick(own, "Цена за ед. (ам. долл.)") ?? pick(own, "Цена за ед., $");
  if (fromOwn != null && fromOwn > 0) return fromOwn;
  for (const p of planBreakdowns) {
    const items = itemsOf((p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown);
    const v = pick(items, "Цена за ед. (ам. долл.)") ?? pick(items, "Цена за ед., $");
    if (v != null && v > 0) return v;
  }
  return null;
}
