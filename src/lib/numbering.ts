import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Generates a per-org sequential document number, e.g. "З-2026-0007". Call
 * within a transaction.
 *
 * Based on the highest existing number for this org/prefix/year, not a row
 * count — a count goes stale (and collides with an existing row) the
 * moment any document has ever been deleted, leaving a gap between the
 * live row count and the highest number actually issued.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  model: "purchase" | "productionOrder",
  organizationId: string,
  prefix: string
) {
  const year = new Date().getFullYear();
  const numberPrefix = `${prefix}-${year}-`;

  const latest =
    model === "purchase"
      ? await tx.purchase.findFirst({
          where: { organizationId, number: { startsWith: numberPrefix } },
          orderBy: { number: "desc" },
          select: { number: true },
        })
      : await tx.productionOrder.findFirst({
          where: { organizationId, number: { startsWith: numberPrefix } },
          orderBy: { number: "desc" },
          select: { number: true },
        });

  const lastSeq = latest ? Number(latest.number.slice(numberPrefix.length)) : 0;
  return `${numberPrefix}${String(lastSeq + 1).padStart(4, "0")}`;
}
