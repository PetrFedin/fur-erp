"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNum, parseDateInput } from "@/lib/input";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"] as const;

const schema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  amount: zNum("Сумма", { positive: true }),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z
    .string()
    .min(1, "Укажите дату оплаты")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата оплаты"),
  notes: z.string().trim().max(1000).optional(),
});

// Форма — обычный <form action>, возвращать ошибку некуда: показываем её
// баннером на странице через ?error=.
function fail(message: string): never {
  redirect(`/payments?error=${encodeURIComponent(message)}`);
}

export async function createAdvancePayment(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = schema.safeParse({
    supplierId: formData.get("supplierId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Проверьте поля формы");
  const badRef = await checkOrgRefs(session.user.organizationId, { supplier: parsed.data.supplierId });
  if (badRef) fail(badRef);

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
