/**
 * М026: категория «Пальто женское из норки с шарфом» (описание изделия, не категория) → «Пальто» из справочника CategoryRef.
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-m026-category.ts [--apply | --rollback --apply]
 * Журнал: docs-inventory/corrections-journal-fix-m026-category.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-fix-m026-category.json");

(async () => {
  try {
    if (ROLLBACK) {
      const j = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет возвращено: «${j.before.category}» (добавьте --apply)`);
      await prisma.productModel.update({ where: { id: j.id }, data: { category: j.before.category, categoryRefId: j.before.categoryRefId } });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено");
    const m = await prisma.productModel.findFirstOrThrow({ where: { name: "М026" } });
    const ref = await prisma.categoryRef.findFirstOrThrow({ where: { organizationId: m.organizationId, name: "Пальто" } });
    console.log(`М026: «${m.category}» (ref ${m.categoryRefId ?? "—"}) → «${ref.name}» (ref ${ref.id})`);
    if (!APPLY) return console.log("Пробный прогон: ничего не записано");
    writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), id: m.id, before: { category: m.category, categoryRefId: m.categoryRefId } }, null, 1));
    await prisma.productModel.update({ where: { id: m.id }, data: { category: ref.name, categoryRefId: ref.id } });
    console.log("Готово");
  } finally {
    await prisma.$disconnect();
  }
})();
