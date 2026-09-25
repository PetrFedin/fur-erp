export const NAV_SECTIONS = [
  {
    title: "Обзор",
    links: [{ href: "/dashboard", label: "Дашборд" }],
  },
  {
    title: "Закупки и склад",
    links: [
      { href: "/purchases", label: "Закупки сырья" },
      { href: "/lots", label: "Остатки и архив сырья" },
      { href: "/suppliers", label: "Поставщики" },
      { href: "/payments", label: "Оплаты" },
    ],
  },
  {
    title: "Производство",
    links: [
      { href: "/production", label: "Производственные заказы (ТЗ)" },
      { href: "/finished-stock", label: "Остатки готовой продукции" },
      { href: "/models", label: "Модели изделий" },
      { href: "/clients", label: "Заказчики" },
    ],
  },
  {
    title: "",
    links: [{ href: "/settings", label: "Настройки" }],
  },
] as const;
