/**
 * Однозначные исправления по итогам полной сверки (docs-inventory/crosscheck-fixes-plan.json,
 * строится scripts/build-crosscheck.py). Пишет ТОЛЬКО ProductionOrder.producedQuantity и ProductionOrder.size.
 * Статус, себестоимость, склад готовой продукции, verifiedAt — не трогает.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-crosscheck-fixes.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-crosscheck-fixes.ts --apply    # запись (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-crosscheck-fixes.ts --rollback docs-inventory/corrections-journal-crosscheck.json
 * Идемпотентно: producedQuantity трогается только если сейчас 0; size — только если равен значению «до».
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const INV = join(resolve(__dirname, ".."), "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-crosscheck.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rb = args.indexOf("--rollback");
const MARK = "[сверка 2026-10-04]";

type Fix = { kind: "produced" | "size"; order: string; planned?: number; old?: string; value: number | string; basis: string };
type J = { order: string; field: string; before: string | null; after: string; notesBefore: string | null }[];

async function main() {
  if (rb >= 0) {
    const j: J = JSON.parse(readFileSync(args[rb + 1], "utf8"));
    for (const e of j) {
      const o = await prisma.productionOrder.findFirst({ where: { number: e.order } });
      if (!o) continue;
      const cur = e.field === "producedQuantity" ? o.producedQuantity.toString() : o.size;
      if (String(cur) !== String(e.after) && Number(cur) !== Number(e.after)) { console.log("пропуск (изменено после скрипта)", e.order, e.field); continue; }
      await prisma.productionOrder.update({ where: { id: o.id }, data: e.field === "producedQuantity" ? { producedQuantity: e.before ?? "0", notes: e.notesBefore } : { size: e.before, notes: e.notesBefore } });
      console.log("откат", e.order, e.field);
    }
    return;
  }
  const plan: Fix[] = JSON.parse(readFileSync(join(INV, "crosscheck-fixes-plan.json"), "utf8"));
  const journal: J = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : [];
  let n = 0;
  for (const f of plan) {
    const o = await prisma.productionOrder.findFirst({ where: { number: f.order } });
    if (!o) { console.log("нет ТЗ", f.order); continue; }
    const line = `${MARK} ${f.kind === "produced" ? "выпуск" : "размер"}: ${f.basis}`;
    if (f.kind === "produced") {
      if (!o.producedQuantity.isZero()) continue;
      if (Number(o.plannedQuantity) !== f.planned) { console.log("план изменился, пропуск", f.order); continue; }
      console.log(`${f.order}: выпуск 0 → ${f.value}`);
      if (APPLY) {
        await prisma.productionOrder.update({ where: { id: o.id }, data: { producedQuantity: String(f.value), notes: (o.notes ? o.notes + "\n" : "") + line } });
        journal.push({ order: f.order, field: "producedQuantity", before: "0", after: String(f.value), notesBefore: o.notes });
      }
    } else {
      if (o.size !== f.old) continue;
      console.log(`${f.order}: размер ${f.old} → ${f.value}`);
      if (APPLY) {
        await prisma.productionOrder.update({ where: { id: o.id }, data: { size: String(f.value), notes: (o.notes ? o.notes + "\n" : "") + line } });
        journal.push({ order: f.order, field: "size", before: f.old ?? null, after: String(f.value), notesBefore: o.notes });
      }
    }
    n++;
  }
  if (APPLY) writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  console.log(APPLY ? `применено: ${n}` : `DRY-RUN: ${n} операций`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
