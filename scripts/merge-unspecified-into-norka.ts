/**
 * "Сырьё (не указано)" (141 pcs bought / 135 used / 6 remaining, 60 000 ₽)
 * was never genuinely unidentified — its 2 lots (5020, 300302) are both
 * explicitly "Шкура норка белая, отбеленная 20" / category "Норка" in the
 * source registry's "остатки" sheet (rows 144-145), and 2 of its 4
 * ProductionMaterialUsage rows carry ТЗ material description "Норка
 * белая". It landed in a separate "unspecified" bucket during the
 * original bulk import instead of being mapped to the existing "Норка"
 * material.
 *
 * This merges it into "Норка" (reassigning lots/purchase items/usages/
 * stock movements/BOM lines, tagging the two lots with the source's own
 * grade/color text) and deletes the now-empty "Сырьё (не указано)" row.
 * Idempotent: a no-op if "Сырьё (не указано)" no longer exists.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/merge-unspecified-into-norka.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const unspecified = await prisma.rawMaterial.findFirst({ where: { name: "Сырьё (не указано)" } });
  if (!unspecified) {
    console.log("Nothing to do: 'Сырьё (не указано)' doesn't exist (already merged?).");
    return;
  }
  const norka = await prisma.rawMaterial.findFirstOrThrow({ where: { name: "Норка" } });

  await prisma.$transaction([
    prisma.rawMaterialLot.updateMany({
      where: { rawMaterialId: unspecified.id },
      data: { rawMaterialId: norka.id, grade: "Шкура норка белая, отбеленная 20", color: "Белый" },
    }),
    prisma.purchaseItem.updateMany({
      where: { rawMaterialId: unspecified.id },
      data: { rawMaterialId: norka.id, grade: "Шкура норка белая, отбеленная 20", color: "Белый" },
    }),
    prisma.productionMaterialUsage.updateMany({
      where: { rawMaterialId: unspecified.id },
      data: { rawMaterialId: norka.id },
    }),
    prisma.stockMovement.updateMany({
      where: { rawMaterialId: unspecified.id },
      data: { rawMaterialId: norka.id },
    }),
    prisma.productModelMaterial.updateMany({
      where: { rawMaterialId: unspecified.id },
      data: { rawMaterialId: norka.id },
    }),
  ]);

  await prisma.rawMaterial.delete({ where: { id: unspecified.id } });
  console.log("Merged 'Сырьё (не указано)' into 'Норка' and deleted the placeholder material.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
