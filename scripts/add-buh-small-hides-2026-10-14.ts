/**
 * Мелкие шкуры из ОСВ бухгалтерии (сч. 10.01 «Склад (Мех)» на 14.10.2026), которых нет в системе: заводит лоты без закупки.
 * Количество и сумма БЕЗ НДС — как в ОСВ (остаток = приход, списаний не было); НДС 22 % только для разбивки.
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал id созданных записей); --rollback --apply удаляет созданное.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-buh-small-hides-2026-10-14.ts <buh.json> [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-buh-small-hides-2026-10-14.json");
const MATERIAL: [RegExp, string][] = [
  [/бобр/i, "Бобр"], [/выдра/i, "Выдра"], [/каракульча/i, "Каракульча"], [/рысевидная/i, "Рысевидная кошка"], [/фишер/i, "Фишер"], [/шиншилла/i, "Шиншилла"],
  [/свакара/i, "Свакара"], [/соболь/i, "Соболь"], [/норк/i, "Норка"],
];
const SKIP = /10026|лиса арктическая|лисицы красной|махагон|американск|белой выделанная|браун 0 F|браун самец|виолет|жемчуг|ирис|лаванд|пастель|SWAKARA|тонирован/i;
const VAT = 22;

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:buh-small-hides");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { lots: string[]; materials: string[] };
    if (APPLY) {
      await prisma.stockMovement.deleteMany({ where: { lotId: { in: j.lots } } });
      await prisma.rawMaterialLot.deleteMany({ where: { id: { in: j.lots } } });
      await prisma.rawMaterial.deleteMany({ where: { id: { in: j.materials }, lots: { none: {} } } });
    }
    return console.log(APPLY ? "откат выполнен" : `пробный откат: лотов ${j.lots.length}`);
  }
  const buh = JSON.parse(readFileSync(process.argv[2], "utf8")) as { name: string; art: string; endD: number | ""; q_in: number; q_out: number | ""; q_end: number }[];
  const org = await prisma.organization.findFirstOrThrow();
  const wh = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: org.id, isDefault: true } });
  const have = new Set((await prisma.rawMaterialLot.findMany({ select: { lotNumber: true, grade: true } })).map((l) => `${l.lotNumber}|${l.grade}`));
  const rows = buh.filter((b) => /^Шкур[аи]\s/.test(b.name) && b.q_end === b.q_in && !b.q_out && !SKIP.test(b.name) && Number(b.endD) > 0);
  const plan = rows.map((b) => {
    const mat = MATERIAL.find(([re]) => re.test(b.name))?.[1];
    return { b, mat, key: `${b.art || null}|${b.name}` };
  });
  let sum = 0, qty = 0;
  for (const p of plan) { console.log(`${p.mat ?? "??? материал"} | ${p.b.name} | ${p.b.q_end} шт. | ${p.b.endD} ₽ без НДС`); sum += Number(p.b.endD); qty += p.b.q_end; }
  console.log(`итого ${plan.length} строк, ${qty} шт., ${Math.round(sum * 100) / 100} ₽ без НДС (ожидается 22 шт., 217 350 ₽)`);
  if (plan.some((p) => !p.mat)) throw new Error("не определён материал у части строк");
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  void have;
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const createdLots: string[] = [], createdMats: string[] = [];
  const date = new Date("2026-10-14T00:00:00Z");
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      let m = await tx.rawMaterial.findFirst({ where: { organizationId: org.id, name: p.mat! } });
      if (!m) { m = await tx.rawMaterial.create({ data: { organizationId: org.id, name: p.mat!, unit: "PIECE" } }); createdMats.push(m.id); }
      const ex = Number(p.b.endD), q = p.b.q_end;
      const unitIncl = Math.round(((ex * (100 + VAT)) / 100 / q) * 100) / 100;
      const unitEx = Math.round((ex / q) * 100) / 100;
      const total = Math.round(unitIncl * q * 100) / 100;
      const lot = await tx.rawMaterialLot.create({
        data: {
          organizationId: org.id, warehouseId: wh.id, rawMaterialId: m.id, lotNumber: p.b.art || null, grade: p.b.name,
          quantityReceived: q, quantityRemaining: q, unitCost: unitIncl, totalCost: total, vatRate: VAT,
          materialCostExclVat: unitEx, materialVatAmount: Math.round((unitIncl - unitEx) * 100) / 100,
          receivedDate: date, notes: "Заведён по ОСВ бухгалтерии (сч. 10.01, 14.10.2026): покупка не на аукционе, дата прихода неизвестна",
        },
      });
      createdLots.push(lot.id);
      await tx.stockMovement.create({ data: { organizationId: org.id, warehouseId: wh.id, rawMaterialId: m.id, lotId: lot.id, type: "ADJUSTMENT_IN", quantity: q, unitCost: unitIncl, totalCost: total, notes: "По ОСВ бухгалтерии на 14.10.2026" } });
    }
  });
  writeFileSync(JOURNAL, JSON.stringify({ lots: createdLots, materials: createdMats }, null, 1));
  console.log(`создано лотов ${createdLots.length}, новых материалов ${createdMats.length}; журнал ${JOURNAL}`);
}
main().then(() => process.exit(0));
