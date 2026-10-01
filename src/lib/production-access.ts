import type { UserRole } from "@prisma/client";

// Roles allowed to change ТЗ (create / edit / write off / pay / complete).
// Kept in one plain module so server actions (requireRole) and pages (hide
// the edit controls) cannot drift apart.
export const PRODUCTION_EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const satisfies readonly UserRole[];

export function canEditProduction(role: UserRole | string | undefined | null): boolean {
  return (PRODUCTION_EDIT_ROLES as readonly string[]).includes(role ?? "");
}
