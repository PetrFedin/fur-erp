import type { UserRole } from "@prisma/client";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import type { VerifyKind } from "@/lib/verification-kinds";

// Кто может подтверждать строки: платежи поставщику и закупки — как закупки/оплаты поставщикам; ТЗ, партии и оплаты производства — как правка производства.
// Один простой модуль, чтобы server actions и страницы (кнопки) не расходились.
const SUPPLIER_ROLES = [...new Set([...ACCESS.purchases, ...ACCESS.supplierPayments])] as UserRole[];
export const VERIFY_ROLES_BY_KIND: Record<VerifyKind, readonly string[]> = {
  payment: SUPPLIER_ROLES,
  purchase: SUPPLIER_ROLES,
  prodPayment: PRODUCTION_EDIT_ROLES,
  order: PRODUCTION_EDIT_ROLES,
  batch: PRODUCTION_EDIT_ROLES,
};
export const canVerify = (role: string | null | undefined, kind: VerifyKind) => hasRole(role, VERIFY_ROLES_BY_KIND[kind]);
