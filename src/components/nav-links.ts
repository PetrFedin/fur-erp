// Основное меню (7 пунктов). `also` — вложенные и переехавшие разделы: на них
// подсвечивается тот же пункт, чтобы человек не терял, "где он".
export const NAV_LINKS = [
  { href: "/dashboard", label: "Главная", also: [] },
  // «Сырьё» — один раздел с вкладками (<RawTabs>): Закупки · Мех · Подкладка · Сводка по годам. Закупки — первая вкладка.
  { href: "/lots", label: "Сырьё", also: ["/purchases", "/lining", "/raw-materials", "/analytics"] },
  { href: "/production", label: "ТЗ", also: ["/shipments", "/fittings", "/plan", "/calendar", "/supply-plan"] },
  { href: "/articles", label: "Изделия", also: ["/models", "/finished-stock", "/analytics/products", "/analytics/pricing"] },
  { href: "/payments", label: "Оплаты", also: [] },
  // «Контроль» — один раздел с вкладками (<ControlTabs>): Задачи · Подтвердить · Документы · Сверка · Анализ документов · История.
  // Адреса страниц прежние, меняется только то, какой пункт меню на них подсвечен.
  { href: "/attention", label: "Контроль", also: ["/verify", "/documents", "/reconciliation", "/document-analysis", "/history"] },
  // «Настройки» — только справочники и параметры.
  { href: "/settings", label: "Настройки", also: ["/clients", "/suppliers", "/materials", "/warehouses", "/expense-categories", "/users"] },
] as const;

/**
 * Какой пункт меню подсвечивать на этом адресе: побеждает самый длинный подходящий префикс.
 * Так «/analytics/products» относится к «Изделиям», а остальная «/analytics» — к «Сырью»,
 * и одна страница не подсвечивает два пункта сразу.
 */
export function activeNavHref(pathname: string): string | null {
  let best: { href: string; len: number } | null = null;
  for (const link of NAV_LINKS) {
    for (const h of [link.href, ...link.also]) {
      if ((pathname === h || pathname.startsWith(h + "/")) && (!best || h.length > best.len)) best = { href: link.href, len: h.length };
    }
  }
  return best?.href ?? null;
}
