/**
 * «Лиса красная» — это вид «Лиса», а «красная» — цвет. Проставляет цвет «Красный» (ColorRef) у лотов и позиций
 * закупок, у которых материал — «Лиса красная» (и вообще лиса с «красн…» в названии материала), но цвет не задан.
 * Название материала в справочнике и в закупках НЕ меняется; материалы не сливаются (это отдельное решение — см. отчёт).
 * Списания ТЗ (ProductionMaterialUsage) цвета не хранят: они берут цвет из лота, поэтому отдельной правки не требуют.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/color-red-fox.ts             # сухой прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/color-red-fox.ts --apply     # применить (сначала scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/color-red-fox.ts --rollback  # вернуть как было по журналу
 *
 * Правило: правятся только строки, где colorRefId пуст (чужой цвет не перезаписывается — такие выводятся как «конфликты»);
 * текстовое поле color заполняется «Красный», только если оно пустое. Идемпотентно: повторный запуск ничего не меняет.
 * Журнал: docs-inventory/corrections-journal-color-red-fox.json (прежние значения каждой строки).
 */
import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-color-red-fox.json");
const COLOR_NAME = "Красный";
/** Материал «Лиса красная» (и «Лиса …красная…»): цвет в названии. */
const RED_FOX = /^лиса(\s|$).*красн/i;

type Prev = { table: "RawMaterialLot" | "PurchaseItem"; id: string; colorRefId: string | null; color: string | null };
type Journal = { script: string; appliedAt?: string; rolledBackAt?: string; colorRefId?: string; createdColorRef?: boolean; rows: Prev[] };

function recentBackup(): string | null {
  const dir = join(homedir(), "Backups", "fur-erp");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^fur_erp_.*\.sql\.gz$/.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
  const last = files.sort((a, b) => b.t - a.t)[0];
  return last && Date.now() - last.t < 60 * 60 * 1000 ? last.f : null;
}

async function main() {
  if (ROLLBACK) {
    const j = readJson<Journal>(JOURNAL, { script: "color-red-fox.ts", rows: [] });
    let n = 0;
    for (const r of j.rows) {
      const data = { colorRefId: r.colorRefId, color: r.color };
      if (r.table === "RawMaterialLot") await prisma.rawMaterialLot.update({ where: { id: r.id }, data });
      else await prisma.purchaseItem.update({ where: { id: r.id }, data });
      n++;
    }
    // созданный скриптом ColorRef «Красный» удаляем только если на него больше ничего не ссылается
    if (j.createdColorRef && j.colorRefId) {
      const used = (await prisma.rawMaterialLot.count({ where: { colorRefId: j.colorRefId } })) + (await prisma.purchaseItem.count({ where: { colorRefId: j.colorRefId } })) + (await prisma.productionOrder.count({ where: { colorRefId: j.colorRefId } }));
      if (used === 0) await prisma.colorRef.delete({ where: { id: j.colorRefId } });
    }
    console.log(`Откат: восстановлено строк ${n}`);
    writeJson(JOURNAL, { script: "color-red-fox.ts", rolledBackAt: new Date().toISOString(), rows: [] });
    return;
  }

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) throw new Error("нет организации");
  let ref = await prisma.colorRef.findFirst({ where: { organizationId: org.id, name: COLOR_NAME } });

  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: org.id, rawMaterial: { name: { contains: "красн", mode: "insensitive" } } },
    select: { id: true, lotNumber: true, color: true, colorRefId: true, rawMaterial: { select: { name: true } } },
  });
  const items = await prisma.purchaseItem.findMany({
    where: { rawMaterial: { organizationId: org.id, name: { contains: "красн", mode: "insensitive" } } },
    select: { id: true, color: true, colorRefId: true, rawMaterial: { select: { name: true } } },
  });
  const fox = <T extends { rawMaterial: { name: string } }>(rows: T[]) => rows.filter((r) => RED_FOX.test(r.rawMaterial.name));
  const needs = (r: { colorRefId: string | null }) => !ref || r.colorRefId !== ref.id;
  const lotTodo = fox(lots).filter((r) => r.colorRefId == null);
  const itemTodo = fox(items).filter((r) => r.colorRefId == null);
  const conflicts = [...fox(lots), ...fox(items)].filter((r) => r.colorRefId != null && needs(r));
  const already = fox(lots).length + fox(items).length - lotTodo.length - itemTodo.length - conflicts.length;

  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  console.log(`ColorRef «${COLOR_NAME}»: ${ref ? `есть (${ref.id})` : "нет — будет создан"}`);
  console.log(`Материалов «Лиса красная»: лотов ${fox(lots).length}, позиций закупок ${fox(items).length}`);
  console.log(`  уже с цветом «${COLOR_NAME}»: ${already}`);
  console.log(`  проставить цвет: лотов ${lotTodo.length}, позиций ${itemTodo.length}`);
  console.log(`  конфликты (другой цвет, не трогаем): ${conflicts.length}`);
  for (const c of conflicts) console.log("   ", JSON.stringify(c));
  if (!APPLY) return;

  if (lotTodo.length + itemTodo.length === 0 && ref) {
    console.log("Нечего менять (идемпотентно).");
    return;
  }
  const backup = recentBackup();
  if (!backup && !process.argv.includes("--no-backup-check")) {
    console.error("Нет свежей (до часа) копии базы в ~/Backups/fur-erp. Сначала выполните scripts/backup.sh.");
    process.exitCode = 1;
    return;
  }
  console.log(`Копия базы: ${backup ?? "(проверка пропущена)"}`);

  let created = false;
  if (!ref) {
    ref = await prisma.colorRef.create({ data: { organizationId: org.id, name: COLOR_NAME, aliases: [] } });
    created = true;
  }
  const prev = readJson<Journal>(JOURNAL, { script: "color-red-fox.ts", rows: [] });
  const rows: Prev[] = [...prev.rows];
  await prisma.$transaction(async (tx) => {
    for (const l of lotTodo) {
      rows.push({ table: "RawMaterialLot", id: l.id, colorRefId: l.colorRefId, color: l.color });
      await tx.rawMaterialLot.update({ where: { id: l.id }, data: { colorRefId: ref!.id, ...(l.color?.trim() ? {} : { color: COLOR_NAME }) } });
    }
    for (const i of itemTodo) {
      rows.push({ table: "PurchaseItem", id: i.id, colorRefId: i.colorRefId, color: i.color });
      await tx.purchaseItem.update({ where: { id: i.id }, data: { colorRefId: ref!.id, ...(i.color?.trim() ? {} : { color: COLOR_NAME }) } });
    }
  });
  writeJson(JOURNAL, { script: "color-red-fox.ts", appliedAt: new Date().toISOString(), colorRefId: ref.id, createdColorRef: created || prev.createdColorRef, rows } satisfies Journal);
  console.log(`Применено: лотов ${lotTodo.length}, позиций ${itemTodo.length}. Журнал: ${JOURNAL}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
