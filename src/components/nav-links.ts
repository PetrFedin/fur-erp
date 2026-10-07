// Основное меню. Анализ документов вынесен отдельно от управленческой Сводки. `also` — вложенные и переехавшие разделы: на них
// подсвечивается тот же пункт, чтобы человек не терял, "где он".
export const NAV_LINKS = [
  { href: "/dashboard", label: "Сводка", also: [] },
  { href: "/lots", label: "Сырьё", also: ["/lining", "/raw-materials", "/analytics"] },
  { href: "/purchases", label: "Закупки", also: [] },
  { href: "/production", label: "ТЗ", also: ["/shipments", "/fittings", "/plan", "/calendar"] },
  { href: "/articles", label: "Изделия", also: ["/models", "/finished-stock", "/analytics/products", "/analytics/pricing"] },
  { href: "/document-analysis", label: "Анализ документов", also: ["/documents", "/attention", "/reconciliation", "/verify", "/history"] },
  {
    href: "/settings",
    label: "Настройки",
    also: [
      "/clients",
      "/suppliers",
      "/payments",
      "/supply-plan",
      "/materials",
      "/warehouses",
      "/expense-categories",
      "/users",
    ],
  },
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
