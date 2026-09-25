/**
 * Collapses the raw-material catalog down to base fur categories (Норка,
 * Соболь, Лиса, Рысь, Каракуль (свакара)) instead of one RawMaterial row
 * per color/grade/auction-code variant (the historical + FW26 imports
 * created ~90 fur variants this way). The specific variety that used to be
 * in the material name doesn't disappear — it's preserved on the lot
 * (`RawMaterialLot.grade` / matching `PurchaseItem.grade`), which is where
 * it belongs per the schema (a lot's grade/color, not the catalog's).
 * Cost is already tracked per lot, so this loses no costing detail — only
 * catalog clutter. Lining fabrics (distinct products, not fur grades) and
 * the generic "Сырьё (не указано)" fallback are left untouched.
 *
 * Idempotent: a category with nothing left to merge is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/unify-material-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORY_RULES: { category: string; test: (name: string) => boolean }[] = [
  { category: "Норка", test: (n) => /^(Норка|Шкура норки|Шкурка норки)/i.test(n) },
  { category: "Соболь", test: (n) => /^(Соболь|Шкура соболя)/i.test(n) },
  {
    category: "Лиса",
    test: (n) => /^(Лиса,|Шкура лиса|Выделанная шкурка лисицы|Шкурки лисицы)/i.test(n),
  },
  { category: "Рысь", test: (n) => /^Рысь$/i.test(n) },
  {
    category: "Каракуль (свакара)",
    test: (n) => /^(Шкура каракуля|Выделанные крашенные шкурки каракуля|Свакара)/i.test(n),
  },
];

function categoryFor(name: string): string | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(name)) return rule.category;
  }
  return null;
}

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const materials = await prisma.rawMaterial.findMany({ where: { organizationId: org.id } });

  const groups = new Map<string, typeof materials>();
  for (const m of materials) {
    const category = categoryFor(m.name);
    if (!category) continue;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(m);
  }

  let mergedMaterials = 0;
  let updatedLots = 0;
  let updatedItems = 0;

  for (const [category, members] of groups) {
    // Canonical row: an existing one already named exactly the category, or the
    // first member (renamed in place) if none matches.
    let canonical = members.find((m) => m.name === category);
    const others = members.filter((m) => m.id !== canonical?.id);

    if (!canonical) {
      canonical = members[0];
      others.splice(others.indexOf(canonical), 1);
      if (canonical.name !== category) {
        await prisma.rawMaterial.update({ where: { id: canonical.id }, data: { name: category } });
      }
    }

    for (const other of others) {
      const detail = other.name;

      const lots = await prisma.rawMaterialLot.findMany({ where: { rawMaterialId: other.id } });
      for (const lot of lots) {
        await prisma.rawMaterialLot.update({
          where: { id: lot.id },
          data: { rawMaterialId: canonical.id, grade: lot.grade ?? detail },
        });
        updatedLots++;
      }

      const items = await prisma.purchaseItem.findMany({ where: { rawMaterialId: other.id } });
      for (const item of items) {
        await prisma.purchaseItem.update({
          where: { id: item.id },
          data: { rawMaterialId: canonical.id, grade: item.grade ?? detail },
        });
        updatedItems++;
      }

      await prisma.productionMaterialUsage.updateMany({
        where: { rawMaterialId: other.id },
        data: { rawMaterialId: canonical.id },
      });
      await prisma.stockMovement.updateMany({
        where: { rawMaterialId: other.id },
        data: { rawMaterialId: canonical.id },
      });
      await prisma.productModelMaterial.updateMany({
        where: { rawMaterialId: other.id },
        data: { rawMaterialId: canonical.id },
      });

      await prisma.rawMaterial.delete({ where: { id: other.id } });
      mergedMaterials++;
    }
  }

  console.log(
    `Merged ${mergedMaterials} material variants into ${groups.size} base categories; updated ${updatedLots} lots, ${updatedItems} purchase items.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
