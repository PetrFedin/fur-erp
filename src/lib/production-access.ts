import type { UserRole } from "@prisma/client";
import { ACCESS } from "@/lib/access";

// Roles allowed to change ТЗ (create / edit / write off / pay / complete).
// Kept in one plain module so server actions (requireRole) and pages (hide
// the edit controls) cannot drift apart.
export const PRODUCTION_EDIT_ROLES = ACCESS.production;

export function canEditProduction(role: UserRole | string | undefined | null): boolean {
  return (PRODUCTION_EDIT_ROLES as readonly string[]).includes(role ?? "");
}
