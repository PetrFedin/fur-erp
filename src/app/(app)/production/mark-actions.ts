"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readOneDriveFile, writeDriveFile } from "@/lib/drive-files";
import { resetVerification } from "@/lib/verification";

/**
 * Приложить платёжку к существующей оплате работы (партия/ТЗ). Отметка новой оплаты вынесена в единую форму оплаты:
 * src/components/payment-form.tsx + payments/pay-actions.ts.
 */

export type MarkProdState = { error?: string; ok?: boolean; confirm?: string };

function revalidateAll(orderIds: string[], batchNumber: number | null) {
  revalidatePath("/production");
  revalidatePath("/production/batches");
  if (batchNumber != null) revalidatePath(`/production/batches/${batchNumber}`);
  for (const id of orderIds) revalidatePath(`/production/${id}`);
  revalidatePath("/payments");
  revalidatePath("/documents");
  revalidatePath("/reconciliation");
  revalidatePath("/attention");
  revalidatePath("/clients/[id]", "page");
}

/** Приложить платёжку к существующей оплате производства: оплата становится «подтверждена». */
export async function attachProductionPaymentProof(paymentId: string, formData: FormData): Promise<MarkProdState> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  const orgId = session.user.organizationId;
  const pay = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: { id: true, paidAt: true, status: true, orders: { select: { productionOrderId: true, productionOrder: { select: { batch: { select: { number: true } } } } } } },
  });
  if (!pay) return { error: "Оплата не найдена" };
  if (pay.status === "CANCELLED") return { error: "Оплата отменена" };
  const read = await readOneDriveFile(formData);
  if ("error" in read) return { error: read.error };
  const stored = await writeDriveFile(orgId, read.file);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.driveDocument.create({
        data: {
          organizationId: orgId,
          driveFileId: `local-${randomUUID()}`,
          title: `Платёжка: оплата ${pay.paidAt.toISOString().slice(0, 10)}`,
          docType: "PAYMENT_PROOF",
          mimeType: stored.storedMime,
          sizeBytes: stored.storedSize,
          ...stored,
          storedAt: new Date(),
          productionPaymentId: pay.id,
        },
      });
      await tx.productionPayment.update({ where: { id: pay.id }, data: { confirmed: true } });
    });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  await resetVerification(prisma, orgId, { prodPaymentIds: [pay.id], orderIds: pay.orders.map((o) => o.productionOrderId) });
  revalidateAll(pay.orders.map((o) => o.productionOrderId), pay.orders[0]?.productionOrder.batch?.number ?? null);
  return { ok: true };
}
