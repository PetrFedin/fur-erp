export const NAV_SECTIONS = [
  {
    title: "Обзор",
    links: [{ href: "/dashboard", label: "Дашборд" }],
  },
  {
    title: "Закупки",
    links: [
      { href: "/purchases", label: "Закупки сырья" },
      { href: "/suppliers", label: "Поставщики" },
      { href: "/payments", label: "Оплаты" },
    ],
  },
  {
    title: "Склад",
    links: [
      { href: "/stock", label: "Остатки сырья" },
      { href: "/lots", label: "Архив сырья" },
      { href: "/finished-stock", label: "Остатки готовой продукции" },
      { href: "/warehouses", label: "Склады" },
    ],
  },
  {
    title: "Производство",
    links: [
      { href: "/production", label: "Производственные заказы" },
      { href: "/models", label: "Модели изделий" },
      { href: "/clients", label: "Заказчики" },
    ],
  },
  {
    title: "Справочники",
    links: [
      { href: "/materials", label: "Сырьё" },
      { href: "/expense-categories", label: "Статьи расходов" },
      { href: "/users", label: "Пользователи" },
    ],
  },
] as const;
