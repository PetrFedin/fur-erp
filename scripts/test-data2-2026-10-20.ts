/**
 * Проверка scripts/apply-data2-2026-10-20.ts на КОПИИ базы: запись → инварианты → повторная запись (ничего) → откат (состояние вернулось).
 *
 *   SCRATCH_URL=postgresql://…/fur_erp_scratch_data2 node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-data2-2026-10-20.ts
 *
 * Защита: имя базы должно содержать «scratch» (боевая fur_erp и копии без этого слова не принимаются). Файлы пишутся во временный UPLOAD_DIR.
 * Копия должна быть без уже применённого скрипта (иначе первая запись ничего не изменит — тест сообщит об этом).
 */
import { execSync } from "child_process";
import { createHash } from "crypto";
import { mkdtempSync, rmSync, existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const url = process.env.SCRATCH_URL ?? "";
const dbName = url.split("?")[0].split("/").pop() ?? "";
if (!/scratch/i.test(dbName) || dbName === "fur_erp") { console.error(`SCRATCH_URL должен указывать на копию с «scratch» в имени (сейчас «${dbName}»).`); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url } } });
let bad = 0, total = 0;
const chk = (ok: boolean, msg: string) => { total++; if (!ok) bad++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };
const upload = mkdtempSync(join(tmpdir(), "data2-uploads-"));
const run = (args: string) => execSync(`node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-data2-2026-10-20.ts ${args}`, { env: { ...process.env, DATABASE_URL: url, UPLOAD_DIR: upload }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

async function stateHash() {
  const q = async (sql: string) => JSON.stringify(await prisma.$queryRawUnsafe(sql));
  const parts = [
    await q(`SELECT id, status, "producedQuantity", "materialCost", "expenseCost", "totalCost", "unitCost", "endDate", notes, "batchNotRequired" FROM "ProductionOrder" ORDER BY id`),
    await q(`SELECT id, name, notes FROM "ProductionBatch" ORDER BY id`),
    await q(`SELECT id, notes, amount FROM "ProductionPayment" ORDER BY id`),
    await q(`SELECT id, notes, amount FROM "Payment" ORDER BY id`),
    await q(`SELECT id, notes, status FROM "Purchase" ORDER BY id`),
    await q(`SELECT id, "storagePath", "storedName", "storedSize", notes FROM "DriveDocument" ORDER BY id`),
    await q(`SELECT id, quantity, "totalCost", "productionOrderId" FROM "FinishedGoodsMovement" ORDER BY id`),
    await q(`SELECT id, quantity, "avgUnitCost" FROM "FinishedGoodsStock" ORDER BY id`),
  ];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

async function main() {
  console.log(`База: ${dbName}`);
  const h0 = await stateHash();
  const out1 = run("--apply");
  const already = /Записывать нечего/.test(out1);
  if (already) console.log("  (копия уже содержит результат скрипта — проверка записи/отката пропущена, проверяю только инварианты)");
  else {
    chk(/все контрольные проверки пройдены/.test(out1), "первая запись: контрольные проверки скрипта пройдены");
    chk(!/✗/.test(out1), "первая запись: нет ✗ в выводе");
  }
  const h1 = await stateHash();
  if (!already) chk(h1 !== h0, "первая запись что-то изменила (копия была без применённого скрипта)");

  // инварианты результата
  const ords = await prisma.productionOrder.findMany({ where: { workOrderNumber: { in: ["75", "97", "104", "158", "169", "170", "171", "172", "173", "174", "175", "176", "177", "178", "179", "180", "181", "182", "183"] } }, select: { number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, totalCost: true, unitCost: true, finishedGoodsMovements: { select: { quantity: true, totalCost: true } } } });
  for (const o of ords) {
    const tz = o.workOrderNumber ?? "";
    if (tz === "175") { chk(o.status === "IN_PROGRESS" && Number(o.producedQuantity) === 0, `ТЗ 175 (${o.number}) не закрыт: принято 0 из 6`); continue; }
    if (tz === "183") { chk(o.status === "PLANNED", `ТЗ 183 (${o.number}) остался «Запланировано» (дубль/не дубль не решён)`); continue; }
    chk(o.status === "COMPLETED", `ТЗ ${tz} (${o.number}): выпущено`);
    chk(Number(o.producedQuantity) === Number(o.plannedQuantity), `ТЗ ${tz} (${o.number}): выпуск = плану (${o.producedQuantity})`);
    chk(Math.abs(Number(o.unitCost ?? 0) * Number(o.producedQuantity) - Number(o.totalCost ?? 0)) <= 0.01 * Number(o.producedQuantity) + 0.01, `ТЗ ${tz} (${o.number}): за ед. × выпуск = итого`);
    chk(o.finishedGoodsMovements.reduce((s, m) => s + Number(m.quantity), 0) === Number(o.producedQuantity), `ТЗ ${tz} (${o.number}): приход ГП = выпуску`);
  }
  const b = await prisma.productionBatch.findMany({ where: { number: { in: [15, 16] } }, select: { number: true, name: true } });
  chk(b.length === 2 && b.every((x) => /резерв/i.test(x.name ?? "")), "партии 15 и 16 на месте и подписаны «резерв» (не удалены)");
  const docs = await prisma.driveDocument.findMany({ where: { notes: { contains: "[data2:2026-10-20]" }, storagePath: { not: null } }, select: { storagePath: true, storedSize: true } });
  chk(docs.length > 0, `Word-приложения прикреплены: ${docs.length}`);
  if (!already) chk(docs.every((d) => d.storagePath && existsSync(join(upload, d.storagePath))), "файлы Word-приложений лежат на диске");
  const n116 = await prisma.productionOrder.findFirst({ where: { workOrderNumber: "116" }, select: { batchNotRequired: true, batchId: true } });
  chk(n116?.batchNotRequired === true && !n116.batchId, "ТЗ 116: без партии");

  const out2 = run("--apply");
  chk(/Записывать нечего/.test(out2), "повторная запись: идемпотентно, ничего не меняет");
  chk((await stateHash()) === h1, "повторная запись: состояние не изменилось");

  if (already) { console.log(bad ? `\nРасхождений: ${bad} из ${total}` : `\nВсе проверки пройдены (${total}).`); await prisma.$disconnect(); rmSync(upload, { recursive: true, force: true }); process.exit(bad ? 1 : 0); }
  const out3 = run("--rollback --apply");
  chk(/Откат выполнен/.test(out3), "откат выполнен");
  chk((await stateHash()) === h0, "после отката состояние = исходному (хеш совпал)");
  const left = await prisma.driveDocument.count({ where: { notes: { contains: "[data2:2026-10-20]" } } });
  chk(left === 0, "после отката в записях документов нет меток data2");
  for (const d of docs) if (d.storagePath && existsSync(join(upload, d.storagePath))) chk(false, `после отката остался файл ${d.storagePath}`);

  console.log(bad ? `\nРасхождений: ${bad} из ${total}` : `\nВсе проверки пройдены (${total}).`);
  await prisma.$disconnect();
  rmSync(upload, { recursive: true, force: true });
  const j = join(__dirname, "..", "docs-inventory", `corrections-journal-data2-2026-10-20-${dbName}.json`);
  try { if (existsSync(j)) unlinkSync(j); } catch { /* */ }
  process.exit(bad ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
