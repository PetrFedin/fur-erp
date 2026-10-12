"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { writeOffFinishedGoodsStock } from "@/lib/stock";
import { checkOrgRefs } from "@/lib/org-guard";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { zNum, MAX_QTY } from "@/lib/input";

const EDIT_ROLES = ["OWNER", "ADMIN", "WAREHOUSE"] as const;

const schema = z.object({
  warehouseId: z.string().optional(),
  productModelId: z.string().min(1),
  quantity: zNum("Количество", { positive: true, max: MAX_QTY }),
  notes: z.string().trim().max(1000).optional(),
});

export type WriteOffState = { error?: string };

export async function writeOffFinishedGoods(
  _prev: WriteOffState,
  formData: FormData
): Promise<WriteOffState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = schema.safeParse({
    warehouseId: formData.get("warehouseId") || undefined,
    productModelId: formData.get("productModelId"),
    quantity: formData.get("quantity"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Склад в форме не выбирается: берём склад, где лежит это изделие (иначе — по умолчанию).
  const orgId = session.user.organizationId;
  const warehouseId =
    parsed.data.warehouseId ||
    (await prisma.finishedGoodsStock.findFirst({ where: { organizationId: orgId, productModelId: parsed.data.productModelId, quantity: { gt: 0 } }, orderBy: { quantity: "desc" }, select: { warehouseId: true } }))?.warehouseId ||
    (await getDefaultWarehouseId(orgId));
  if (!warehouseId) return { error: "Не удалось определить место хранения — обратитесь к администратору" };
  const badRef = await checkOrgRefs(session.user.organizationId, {
    warehouse: warehouseId,
    productModel: parsed.data.productModelId,
  });
  if (badRef) return { error: badRef };

  try {
    await prisma.$transaction(async (tx) => {
      await writeOffFinishedGoodsStock(tx, {
        organizationId: session.user.organizationId,
        warehouseId,
        productModelId: parsed.data.productModelId,
        quantity: parsed.data.quantity,
        type: "WRITE_OFF_OUT",
        notes: parsed.data.notes,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать продукцию" };
  }

  revalidateAll(session.user.organizationId);
  return {};
}
