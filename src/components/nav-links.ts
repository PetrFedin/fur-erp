// Меню из 6 пунктов. `also` — вложенные и переехавшие разделы: на них
// подсвечивается тот же пункт, чтобы человек не терял, "где он".
export const NAV_LINKS = [
  { href: "/dashboard", label: "Сводка", also: [] },
  { href: "/lots", label: "Сырьё", also: ["/lining", "/raw-materials"] },
  { href: "/purchases", label: "Закупки", also: [] },
  { href: "/production", label: "ТЗ", also: ["/shipments", "/fittings"] },
  { href: "/articles", label: "Изделия", also: ["/models", "/finished-stock"] },
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
      "/attention",
      "/documents",
      "/reconciliation",
    ],
  },
] as const;
