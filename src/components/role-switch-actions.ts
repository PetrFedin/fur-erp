"use server";

import { redirect } from "next/navigation";
import { unstable_update } from "@/auth";
import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { roleSwitchEnabled } from "@/lib/security-env";

/**
 * Демо-переключение «заказчик → кабинет поставщика» без повторного входа. Это не второй вход: в подписанный JWT
 * ставится claim actAsUserId, который проверяется заново на каждый запрос (lib/session.ts) и в самом jwt-колбэке (src/auth.ts).
 * Доступно только настоящему OWNER/ADMIN, только на активного поставщика своей организации, только при ALLOW_ROLE_SWITCH.
 */
export async function switchToSupplier(formData: FormData) {
  const s = await getFreshSession({ allowSupplier: true });
  if (!s || !roleSwitchEnabled()) redirect("/login");
  // Поставщик (в том числе в режиме просмотра) никогда не переключается на другую роль.
  if (s.user.realUserId || (s.user.role !== "OWNER" && s.user.role !== "ADMIN")) redirect("/dashboard?error=forbidden");
  const id = String(formData.get("userId") ?? "").slice(0, 64);
  const target = await prisma.user.findFirst({
    where: { id, role: "SUPPLIER", isActive: true, organizationId: s.user.organizationId },
    select: { id: true },
  });
  if (!target) redirect("/dashboard?error=forbidden");
  await unstable_update({ actAs: target.id } as never);
  redirect("/supplier");
}

/** Обратно в кабинет заказчика: только из режима, начатого владельцем (в сессии есть подтверждённый realUserId). */
export async function switchBack() {
  const s = await getFreshSession({ allowSupplier: true });
  if (!s) redirect("/login");
  if (!s.user.realUserId) redirect("/dashboard?error=forbidden");
  await unstable_update({ actAs: null } as never);
  redirect("/dashboard");
}
