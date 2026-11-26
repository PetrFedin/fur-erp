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
  // «Входящие» (/inbox): проверка и приём черновиков от внешнего поставщика (расчёты аукционов, ТЗ). Поставщика (SUPPLIER) сюда не пускаем.
  inbox: ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER"],
  // Чат с поставщиком (/chat): внутренние роли видят все обсуждения организации; SUPPLIER — только свои (отдельная проверка в chat.ts).
  chat: ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT"],
  // Каналы мессенджеров (/settings/channels): токен, привязки, WhatsApp.
  channels: ["OWNER", "ADMIN"],
  // «Загрузка данных» (/settings/import): загрузка продаж, прайса и размеров из xlsx, откат по журналу.
  dataImport: ["OWNER", "ADMIN"],
  taskDecisions: ["OWNER", "ADMIN"],
  // «Контроль → Данные» (/data-check): проверки единой витрины, пересборка и утверждение эталона (решение владельца 22.11.2026).
  dataCheck: ["OWNER", "ADMIN"],
  // Деньги компании (решение владельца 22.11.2026): Главная (активы, расходы, продажи), Cashflow, Сверка. Закупщик и технолог видят свои разделы
  // (закупки и оплаты по закупкам; ТЗ и себестоимость), кладовщик и наблюдатель — без денег.
  dashboard: ["OWNER", "ADMIN", "ACCOUNTANT"],
  cashflow: ["OWNER", "ADMIN", "ACCOUNTANT"],
  reconciliation: ["OWNER", "ADMIN", "ACCOUNTANT"],
  // Разделы ниже собраны 26.11.2026 из списков ролей, объявленных прямо в файлах действий и страниц (этап 7: права в одном месте).
  // Составы ролей перенесены без изменений.
  // Изделия и фурнитура (/fittings): создание, правка, фото.
  fittings: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Бюджет (/budget): прогнозы, план в штуках, план FW27.
  budget: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Прогноз продаж (/sales, прогноз).
  salesForecast: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Отгрузки и пошив у подрядчика (/shipments): партии, строки, распределение, отметки, ЗИ.
  shipments: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Отмена принятой отгрузки (вернуть этап в «ожидаемые»).
  shipmentReopen: ["OWNER", "ADMIN"],
  // Производство: правка ТЗ и партий пошива.
  production: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Категории расходов (/settings/expense-categories).
  expenseCategories: ["OWNER", "ADMIN", "ACCOUNTANT"],
  // Свои поля лотов (/lots).
  lotFields: ["OWNER", "ADMIN", "PURCHASER"],
  // Приём сырья на склад и правка лота (этапы, количество): закупщик и кладовщик.
  receiving: ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"],
  // Документы оплат (заказчику и подрядчику) и документы без своего раздела (лоты без закупки, клиенты, поставщики):
  // прикреплять и убирать — только владелец и администратор.
  restrictedDocs: ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly UserRole[]>;

// Темы групп чата (перенесено из chat-core.ts 26.11.2026 — права в одном месте).
/** Темы групп: кто из ролей имеет доступ к теме и может ли быть участником поставщик (SUPPLIER). Оплаты и «Общее» — только свои. */
export const GROUP_TOPICS: Record<string, { roles: readonly string[]; supplier: boolean }> = {
  "Оплаты": { roles: ["OWNER", "ADMIN", "ACCOUNTANT"], supplier: false },
  "Отгрузки": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Аукционы": { roles: ["OWNER", "ADMIN", "PURCHASER"], supplier: true },
  "Сырьё": { roles: ["OWNER", "ADMIN", "PURCHASER"], supplier: true },
  "ТЗ": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Изделия": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Календарь": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Общее": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT"], supplier: false },
};

export function hasRole(role: string | undefined | null, allowed: readonly string[]): boolean {
  return allowed.includes(role ?? "");
}
