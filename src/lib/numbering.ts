import "server-only";
import type { Prisma } from "@prisma/client";

/** Generates a per-org sequential document number, e.g. "З-2026-0007". Call within a transaction. */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  model: "purchase" | "productionOrder",
  organizationId: string,
  prefix: string
) {
  const year = new Date().getFullYear();
  const count =
    model === "purchase"
      ? await tx.purchase.count({ where: { organizationId } })
      : await tx.productionOrder.count({ where: { organizationId } });

  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}
