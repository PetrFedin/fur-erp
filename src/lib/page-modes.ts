/**
 * Какие режимы показа в шапке имеют смысл на странице (решение владельца 16.11): показываем только те, что реально действуют.
 *  year — фильтр «Год»; vat — «Цены: с НДС / без НДС»; c4 — «4 % к сырью».
 * Правила идут по префиксу пути; первое совпадение выигрывает. Не перечисленные страницы получают все три (прежнее поведение).
 */
export type PageModes = { year: boolean; vat: boolean; c4: boolean };

const ALL: PageModes = { year: true, vat: true, c4: true };
const NONE: PageModes = { year: false, vat: false, c4: false };

const RULES: [prefix: string, modes: PageModes][] = [
  // Без режимов: данные не зависят ни от года, ни от НДС, ни от 4 %
  ["/budget", NONE], ["/chat", NONE], ["/settings", NONE], ["/clients", NONE], ["/suppliers", NONE], ["/warehouses", NONE],
  ["/materials", NONE], ["/users", NONE], ["/expense-categories", NONE], ["/scheme", NONE], ["/comments", NONE], ["/supplier", NONE],
  // Сырьё: закупка — без 4 % (закупка, не себестоимость); лоты — все три
  ["/purchases", { year: true, vat: true, c4: false }],
  ["/lots", ALL],
  // Продажи: отчёт привязан к сезонам, «Год» не нужен; НДС и 4 % действуют (маркап к себестоимости)
  ["/sales", { year: false, vat: true, c4: true }],
  ["/catalog", { year: false, vat: true, c4: true }],
  // Отгрузки и календарь: год и НДС
  ["/shipments", { year: true, vat: true, c4: false }],
  ["/calendar", { year: true, vat: true, c4: false }],
  // Оплаты: суммы платёжек всегда как оплачено (с НДС), 4 % не нужен
  ["/payments", { year: true, vat: false, c4: false }],
  // Cashflow: свой период; НДС — один, общий
  ["/cashflow", { year: false, vat: true, c4: false }],
  // Контроль: только год
  ["/attention", { year: true, vat: false, c4: false }],
  ["/verify", { year: true, vat: false, c4: false }],
  ["/documents", { year: true, vat: false, c4: false }],
  ["/reconciliation", { year: true, vat: false, c4: false }],
  ["/history", { year: true, vat: false, c4: false }],
  ["/inbox", { year: true, vat: false, c4: false }],
];

/** Режимы, которые показываем в шапке на странице `pathname`. */
export function modesForPath(pathname: string | null | undefined): PageModes {
  const p = pathname ?? "";
  for (const [prefix, modes] of RULES) if (p === prefix || p.startsWith(prefix + "/")) return modes;
  return ALL;
}
