// Группировка строк «Как получилась цена лота» по этапам цепочки.
// Только классификация подписей: значения и подписи остаются дословно, ничего не считаем и не переводим.

export type BreakdownItem = { label: string; value: number };

export type GroupKey = "auction" | "auctionFees" | "processing" | "delivery" | "commission" | "vat" | "totals" | "other";

export const GROUPS: { key: GroupKey; title: string; hint?: string }[] = [
  { key: "auction", title: "① Покупка лота на аукционе" },
  { key: "auctionFees", title: "② Сборы аукциона" },
  { key: "processing", title: "③ Выделка и обработка" },
  { key: "delivery", title: "④ Доставка и таможня" },
  { key: "commission", title: "⑤ Комиссии" },
  { key: "vat", title: "⑥ НДС" },
  { key: "totals", title: "⑦ Итоги отчёта поставщика", hint: "могут отличаться от итога выше — тот считает приложение" },
  { key: "other", title: "Прочее" },
];

export function classifyLabel(label: string): GroupKey {
  const s = label.toLowerCase().replace(/ё/g, "е").trim();

  // ⑦ итоги и поправки — раньше всего: «Итого таможенные платежи…» — это подытог, а не составляющая
  if (
    s.startsWith("итого") ||
    s.startsWith("оплачено за сырье") ||
    s.startsWith("цена закупка+") ||
    s === "расчетный" ||
    s.startsWith("корректировка")
  )
    return "totals";

  if (s.includes("ндс на аукционный сбор")) return "auctionFees";
  if (s.startsWith("ндс")) return "vat"; // «НДС», «НДС 20%», «НДС на товар/шкуры»

  // ② сборы аукциона (до общих слов «доставка»/«сбор»)
  if (
    s.includes("аукционный сбор") ||
    s.includes("маркетинговый сбор") ||
    s.includes("сбор за доставку") ||
    s.includes("услуги аукциона")
  )
    return "auctionFees";

  // ③ выделка — до «транспорт», т.к. «Транспорт Выделка-Склад»
  if (
    s.includes("выделка") ||
    s.includes("крашение") ||
    s.includes("покраска") ||
    s.includes("тонировка") ||
    s.includes("транспорт на выделку")
  )
    return "processing";

  // ⑤ комиссии
  if (s.startsWith("комиссия") || s.startsWith("брокер") || s.startsWith("брок.") || s.includes("комиссия")) return "commission";

  // ④ доставка и таможня
  if (
    s.includes("перевозка") ||
    s.includes("доставка") ||
    s.includes("транспорт") ||
    s.includes("пошлина") ||
    s.includes("таможн") ||
    s.includes("там.сбор") ||
    s.includes("упаковка")
  )
    return "delivery";

  // ① покупка на аукционе
  if (
    s.includes("молоток") ||
    s.startsWith("курс") ||
    s.includes("валютный курс") ||
    s.startsWith("цена за ед") ||
    s.startsWith("расчетная цена")
  )
    return "auction";

  return "other";
}

/** Единица — только если явно указана в подписи. «%» в подписи чаще ставка («Пошлина 5%», «Комиссия РМ, 4,5%»),
 * а значение — сумма, поэтому «%» показываем лишь когда подпись оканчивается на «, %». */
export function labelUnit(label: string): string | null {
  const s = label.trim().toLowerCase();
  if (/(\$|долл\.?\)?)$/.test(s) || /\(\s*ам\.\s*долл\.?\s*\)$/.test(s)) return "$";
  if (/(₽|\(руб\.?\))$/.test(s) || /,\s*руб\.?$/.test(s)) return "₽";
  if (/,\s*%$/.test(s)) return "%";
  return null;
}

export function groupBreakdownItems(items: BreakdownItem[]): { key: GroupKey; title: string; hint?: string; items: BreakdownItem[] }[] {
  const buckets = new Map<GroupKey, BreakdownItem[]>();
  for (const it of items) {
    const k = classifyLabel(it.label);
    const a = buckets.get(k) ?? [];
    a.push(it); // исходный порядок внутри группы
    buckets.set(k, a);
  }
  return GROUPS.filter((g) => buckets.has(g.key)).map((g) => ({ ...g, items: buckets.get(g.key)! }));
}
