"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"] as const;

const schema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().min(1),
  notes: z.string().trim().optional(),
});

export async function createAdvancePayment(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = schema.safeParse({
    supplierId: formData.get("supplierId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  await prisma.payment.create({
    data: {
      organizationId: session.user.organizationId,
      supplierId: parsed.data.supplierId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      status: "COMPLETED",
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/payments");
}
