import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

/**
 * Свежие данные пользователя из БД (роль, активность, организация).
 * JWT живёт долго, поэтому смена роли / деактивация должны действовать сразу,
 * а не после перелогина. cache() — один запрос на рендер/действие.
 */
const loadUser = cache(async (userId: string) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      organizationId: true,
      name: true,
      supplierId: true,
      organization: { select: { name: true, isActive: true } },
    },
  });
});

/**
 * Сессия с актуальной ролью из БД или null (нет входа / пользователь или
 * организация деактивированы / удалены). Для route handlers.
 */
export type SessionOpts = {
  /** Пускать ли внешнего поставщика (роль SUPPLIER). По умолчанию закрыто: открывать явно, только где нужно. */
  allowSupplier?: boolean;
};

export async function getFreshSession(opts?: SessionOpts) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await loadUser(session.user.id);
  if (!user || !user.isActive || !user.organization.isActive) return null;
  if (user.role === "SUPPLIER" && !opts?.allowSupplier) return null;
  return {
    ...session,
    user: {
      ...session.user,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      name: user.name,
      supplierId: user.supplierId,
    },
  };
}

/**
 * Every server action / page that touches tenant data must go through this.
 * It's the single place that guarantees a organizationId is present before
 * any Prisma query runs, which is what keeps tenants isolated in the
 * app-level scoping model (see prisma/schema.prisma header comment).
 */
export async function requireSession(opts?: SessionOpts) {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session) {
    redirect("/login");
  }
  // Периметр «по умолчанию закрыто»: поставщик попадает только туда, где allowSupplier указан явно.
  if (session.user.role === "SUPPLIER" && !opts?.allowSupplier) redirect("/supplier");
  return session;
}

export async function requireRole(...roles: UserRole[]) {
  // SUPPLIER проходит дальше только если роль названа явно (requireRole("SUPPLIER", ...)).
  const session = await requireSession({ allowSupplier: roles.includes("SUPPLIER") });
  if (!roles.includes(session.user.role)) {
    if (session.user.role === "SUPPLIER") redirect("/supplier");
    redirect("/dashboard?error=forbidden");
  }
  return session;
}
