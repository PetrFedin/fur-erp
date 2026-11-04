/**
 * Одноразовый (05.11.2026): артикул М030 (ТЗ 198 = П-2026-0214, «Пальто из дикого соболя», Бежевый, размер 46) заведён без категории,
 * поэтому ТЗ не попадало ни в слайд «Одежда», ни в «Аксессуары». Категория взята из самого ТЗ (приложение 198 к договору № 1605): «Пальто» → группа «Одежда».
 * Сухой прогон: node --env-file=.env node_modules/.bin/tsx scripts/fix-model-m030-category-2026-11-05.ts
 * Применить:  ... --apply        Откат: ... --rollback scripts/fix-model-m030-category-2026-11-05.journal.json
 */
import { prisma } from "@/lib/prisma";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const JOURNAL = "scripts/fix-model-m030-category-2026-11-05.journal.json";
const MODEL_ID = "cmupc4naw002jlsbfu11gvb6u";
const CATEGORY = "Пальто";

async function main() {
  const rb = process.argv.indexOf("--rollback");
  if (rb >= 0) {
    const path = process.argv[rb + 1];
    if (!existsSync(path)) throw new Error(`нет журнала ${path}`);
    const j = JSON.parse(readFileSync(path, "utf8")) as { modelId: string; before: { category: string | null; categoryRefId: string | null } };
    await prisma.productModel.update({ where: { id: j.modelId }, data: { category: j.before.category, categoryRefId: j.before.categoryRefId } });
    console.log("откат: категория М030 возвращена", j.before);
    return;
  }
  const m = await prisma.productModel.findUniqueOrThrow({ where: { id: MODEL_ID } });
  if (m.name !== "М030") throw new Error(`ожидался артикул М030, найден ${m.name}`);
  const ref = await prisma.categoryRef.findFirstOrThrow({ where: { organizationId: m.organizationId, name: CATEGORY } });
  console.log(`М030: категория ${m.category ?? "—"} → ${CATEGORY} (${ref.group}), ref ${m.categoryRefId ?? "—"} → ${ref.id}`);
  if (!process.argv.includes("--apply")) { console.log("сухой прогон — добавьте --apply"); return; }
  writeFileSync(JOURNAL, JSON.stringify({ modelId: m.id, before: { category: m.category, categoryRefId: m.categoryRefId }, appliedAt: new Date().toISOString() }, null, 2));
  await prisma.productModel.update({ where: { id: m.id }, data: { category: CATEGORY, categoryRefId: ref.id } });
  console.log("готово; журнал отката:", JOURNAL);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
