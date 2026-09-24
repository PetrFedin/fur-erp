import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { UserRole } from "@prisma/client";

/**
 * Every server action / page that touches tenant data must go through this.
 * It's the single place that guarantees a organizationId is present before
 * any Prisma query runs, which is what keeps tenants isolated in the
 * app-level scoping model (see prisma/schema.prisma header comment).
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(...roles: UserRole[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    redirect("/dashboard?error=forbidden");
  }
  return session;
}
