/**
 * RawMaterialLot.sizeGrade: засев разбором текста grade (единое правило src/lib/lot-size.ts).
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-lot-size-grade.ts [--apply|--rollback]
 * Заполняются только лоты с явным размером в тексте; остальные остаются null. Уже заполненные не трогаются.
 * Журнал: docs-inventory/corrections-journal-lot-size.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { parseLotSizeGrade } from "../src/lib/lot-size";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-lot-size.json");

async function main() {
  if (process.argv.includes("--rollback")) {
    const j = readJson<{ ids: string[] }>(JOURNAL, { ids: [] });
    const r = await prisma.rawMaterialLot.updateMany({ where: { id: { in: j.ids } }, data: { sizeGrade: null } });
    console.log(`Откат: ${r.count}`);
    writeJson(JOURNAL, { script: "seed-lot-size-grade.ts", rolledBackAt: new Date().toISOString(), ids: [] });
    return;
  }
  const lots = await prisma.rawMaterialLot.findMany({ select: { id: true, lotNumber: true, grade: true, sizeGrade: true } });
  const set: Array<{ id: string; size: string }> = [];
  const empty: Array<{ lot: string | null; grade: string | null }> = [];
  for (const l of lots) {
    const s = parseLotSizeGrade(l.grade);
    if (s && !l.sizeGrade) set.push({ id: l.id, size: s });
    else if (!s && !l.sizeGrade) empty.push({ lot: l.lotNumber, grade: l.grade });
  }
  const dist: Record<string, number> = {};
  for (const s of set) dist[s.size] = (dist[s.size] ?? 0) + 1;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", `лотов ${lots.length}: заполнить ${set.length}`, dist, `пустых останется ${empty.length}`);
  const noGrade = empty.filter((e) => !e.grade?.trim()).length;
  console.log(`  из пустых: без сорта ${noGrade}, с текстом без размера ${empty.length - noGrade}`);
  if (!APPLY) return;
  for (const s of set) await prisma.rawMaterialLot.update({ where: { id: s.id }, data: { sizeGrade: s.size } });
  const prev = readJson<{ ids: string[] }>(JOURNAL, { ids: [] });
  writeJson(JOURNAL, { script: "seed-lot-size-grade.ts", appliedAt: new Date().toISOString(), ids: [...prev.ids, ...set.map((s) => s.id)] });
  console.log("Применено", set.length);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
