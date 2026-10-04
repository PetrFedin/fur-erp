import type { UserRole } from "@prisma/client";

// Роли, которым разрешено создавать/править справочники и документы. Один
// источник правды для server actions (requireRole), страниц /…/new и кнопок
// «+ Новый …», чтобы они не расходились.
export const ACCESS = {
  suppliers: ["OWNER", "ADMIN", "PURCHASER"],
  clients: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  warehouses: ["OWNER", "ADMIN", "WAREHOUSE"],
  materials: ["OWNER", "ADMIN", "PURCHASER", "TECHNOLOGIST"],
  models: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  purchases: ["OWNER", "ADMIN", "PURCHASER"],
  users: ["OWNER", "ADMIN"],
  supplyPlan: ["OWNER", "ADMIN", "TECHNOLOGIST"],
  // Отметка оплат поставщикам (аукцион/закупка) и приложение платёжек — как на странице «Оплаты».
  supplierPayments: ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"],
} as const satisfies Record<string, readonly UserRole[]>;

export function hasRole(role: string | undefined | null, allowed: readonly string[]): boolean {
  return allowed.includes(role ?? "");
}
