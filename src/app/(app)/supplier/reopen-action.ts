"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession, inboxScope } from "@/lib/supplier-inbox";

/** «Исправить и отправить заново»: отклонённое → снова черновик с теми же данными (комментарий проверяющего остаётся перед глазами). Только свой поставщик. */
export async function reopenRejected(id: string): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireSupplierSession();
  const r = await prisma.supplierInbox.updateMany({
    where: { id, status: "REJECTED", ...inboxScope(s) },
    data: { status: "DRAFT", sentAt: null, decidedAt: null, decidedById: null },
  });
  if (r.count !== 1) return { error: "Это отклонённое не найдено или уже возвращено в черновик" };
  revalidatePath("/supplier/auction-calcs");
  revalidatePath("/supplier/tz");
  revalidatePath(`/supplier/auction-calcs/${id}`);
  revalidatePath(`/supplier/tz/${id}`);
  return { ok: true };
}
