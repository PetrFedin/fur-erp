import type { UserRole } from "@prisma/client";

// Роли, которым разрешено создавать/править справочники и документы. Один
// источник правды для server actions (requireRole), страниц /…/new и кнопок
// «+ Новый …», чтобы они не расходились.
export const ACCESS = {
  suppliers: ["OWNER", "ADMIN", "PURCHASER"],
  clients: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  warehouses: ["OWNER", "ADMIN", "WAREHOUSE"],
  materials: ["OWNER", "ADMIN", "PURCHASER", "TECHNOLOGIST"],
  // Справочник цветов (/settings/colors, добавление цвета из форм) — как справочник материалов.
  colors: ["OWNER", "ADMIN", "PURCHASER", "TECHNOLOGIST"],
  // Справочник аукционов (/settings/auctions): короткие имена, объединение, подтверждение.
  auctions: ["OWNER", "ADMIN", "PURCHASER"],
  // Справочник категорий изделий (/settings/categories, добавление категории из форм модели/артикула).
  categories: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  models: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Справочник меха (/settings/furs): рус/англ названия и синонимы — как справочник материалов.
  furRefs: ["OWNER", "ADMIN", "PURCHASER", "TECHNOLOGIST"],
  purchases: ["OWNER", "ADMIN", "PURCHASER"],
  users: ["OWNER", "ADMIN"],
  supplyPlan: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // План заказа (/plan), сезоны и производственный календарь (/calendar): редактируют производственные роли, читают все.
  planning: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Отметка оплат поставщикам (аукцион/закупка) и приложение платёжек — как на странице «Оплаты».
  supplierPayments: ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"],
  // Журнал изменений (/history, блоки «История изменений» на карточках): читают владелец, администратор, бухгалтер.
  history: ["OWNER", "ADMIN", "ACCOUNTANT"],
  // Комментарии («Оставить комментарий»): создавать и отвечать может любой вошедший; менять статус и удалять чужие — эти роли.
  comments: ["OWNER", "ADMIN"],
  // Решения владельца в «Контроль → Задачи» (двойной учёт, разнос аванса, ставки НДС…): записывают владелец и администратор.
  taskDecisions: ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly UserRole[]>;

export function hasRole(role: string | undefined | null, allowed: readonly string[]): boolean {
  return allowed.includes(role ?? "");
}
