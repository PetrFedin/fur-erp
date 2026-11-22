"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { refreshMartInBackground } from "@/lib/mart/refresh";
import { saveMartExpected, type MartExpected } from "@/lib/mart/expected";

/** «Пересобрать»: запускает пересборку витрины в фоне; результат видно на этой же странице после обновления. */
export async function rebuildMartAction(): Promise<void> {
  const session = await requireRole(...ACCESS.dataCheck);
  refreshMartInBackground(session.user.organizationId);
  revalidatePath("/data-check");
  redirect("/data-check?msg=rebuild");
}

/**
 * «Утвердить числа как эталон»: текущие итоги витрины (заказано, получено, продано, остаток, розница остатка) становятся эталоном с датой.
 * Берутся из последней сборки (DmCheck), а не из формы, — правильность чисел владелец подтверждает глазами на странице.
 */
export async function approveExpectedAction(): Promise<void> {
  const session = await requireRole(...ACCESS.dataCheck);
  const orgId = session.user.organizationId;
  const rows = await prisma.dmCheck.findMany({ where: { organizationId: orgId, key: { in: ["ordered", "received", "sold", "stock", "stockRetail"] } }, orderBy: { builtAt: "desc" } });
  const latest = new Map<string, number>();
  for (const r of rows) if (!latest.has(r.key) && r.actual != null) latest.set(r.key, Number(r.actual));
  const need = ["ordered", "received", "sold", "stock", "stockRetail"];
  if (need.some((k) => !latest.has(k))) redirect("/data-check?msg=no-data");
  const values: MartExpected = { ordered: latest.get("ordered")!, received: latest.get("received")!, sold: latest.get("sold")!, stock: latest.get("stock")!, stockRetailRub: latest.get("stockRetail")! };
  await saveMartExpected(prisma, orgId, values, session.user.name ?? session.user.email ?? "владелец");
  refreshMartInBackground(orgId);
  revalidatePath("/data-check");
  redirect("/data-check?msg=approved");
}
