/**
 * Подкладка: цена лота (unitCost) приведена к totalCost ÷ количество там, где quantityReceived × unitCost расходится с totalCost
 * больше чем на 1 ₽ (ткани №28 и №4 из закупки 07.25: цена округлена до 2 140, по позициям 2 143,80 и 2 142,15). Сумма «Куплено» подкладки
 * на Главной становится равной 6 821 475 ₽ по документам. Списания в ТЗ не меняются.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-lining-unitcost.ts [--apply | --rollback --apply]
 * Журнал: docs-inventory/corrections-journal-fix-lining-unitcost.json
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-fix-lining-unitcost.json");
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const r2 = (n: number) => Math.round(n * 100) / 100;
type Before = { id: string; unitCost: string; materialCostExclVat: string; materialVatAmount: string };

(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (ROLLBACK) {
      const j: { before: Before[]; rolledBack?: string } = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет откачено лотов: ${j.before.length} (добавьте --apply)`);
      for (const b of j.before) await prisma.rawMaterialLot.update({ where: { id: b.id }, data: { unitCost: b.unitCost, materialCostExclVat: b.materialCostExclVat, materialVatAmount: b.materialVatAmount } });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено");
    const lots = await prisma.rawMaterialLot.findMany({ where: { rawMaterial: { unit: "M" } }, include: { rawMaterial: true } });
    const todo = lots.filter((l) => Math.abs(Number(l.quantityReceived) * Number(l.unitCost) - Number(l.totalCost)) > 1);
    const before: Before[] = [];
    for (const l of todo) {
      const q = Number(l.quantityReceived), unit = r2(Number(l.totalCost) / q), vat = Number(l.vatRate);
      const excl = r2(unit / (1 + vat / 100));
      console.log(`${l.rawMaterial.name}: ${q} м × ${l.unitCost} = ${r2(q * Number(l.unitCost))} → × ${unit} = ${r2(q * unit)} (totalCost ${l.totalCost})`);
      before.push({ id: l.id, unitCost: l.unitCost.toString(), materialCostExclVat: l.materialCostExclVat.toString(), materialVatAmount: l.materialVatAmount.toString() });
      if (APPLY) await prisma.rawMaterialLot.update({ where: { id: l.id }, data: { unitCost: unit, materialCostExclVat: excl, materialVatAmount: r2(unit - excl) } });
    }
    if (APPLY) {
      writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), before }, null, 1));
      console.log("Готово");
    } else console.log("Пробный прогон: ничего не записано");
  } finally {
    await prisma.$disconnect();
  }
})();
