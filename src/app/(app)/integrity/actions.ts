"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { getIntegrityReport } from "@/lib/integrity";

/** «Проверить сейчас»: пересчёт отчёта в обход кэша 60 с (только чтение БД). */
export async function recheckIntegrity() {
  const session = await requireSession();
  await getIntegrityReport(session.user.organizationId, { force: true });
  revalidatePath("/integrity");
}
