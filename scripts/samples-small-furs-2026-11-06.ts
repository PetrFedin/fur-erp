/**
 * Владелец, 06.11.2026: бобр, выдра, рысевидная кошка, фишер, шиншилла — «иные расходы, образцы»; в счёте шкур сырья не считаем.
 * Что делает: позиции закупок и лоты этих видов меха убираются из сырья (мех, шкуры, остатки), а их стоимость записывается расходом закупки
 * «Образцы» (категория «Образцы», вид PURCHASE) с теми же суммой и НДС — итог закупки и долг поставщику не меняются. Справочник видов меха помечается «не активен».
 * Журнал для отката: docs-inventory/corrections-journal-samples-small-furs-2026-11-06.json (полные строки удалённых позиций и лотов).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/samples-small-furs-2026-11-06.ts [--apply | --rollback]
 * База берётся из DATABASE_URL (для проб — копия: DATABASE_URL=…/fur_erp_samples_test).
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = process.env.SAMPLES_JOURNAL ?? join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-samples-small-furs-2026-11-06.json");
const NAMES = ["Бобр", "Выдра", "Рысевидная кошка", "Фишер", "Шиншилла"];
const CATEGORY = "Образцы";

(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:samples-small-furs");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      for (const l of j.lots) await tx.rawMaterialLot.create({ data: { ...l, receivedDate: new Date(l.receivedDate), createdAt: new Date(l.createdAt) } });
      for (const i of j.items) await tx.purchaseItem.create({ data: i });
      await tx.purchaseExpense.deleteMany({ where: { id: { in: j.expenseIds } } });
      await tx.purchase.deleteMany({ where: { id: { in: j.samplePurchaseIds } } });
      for (const m of j.materials) await tx.rawMaterial.update({ where: { id: m.id }, data: { isActive: m.isActive } });
      if (j.categoryCreated) await tx.expenseCategory.deleteMany({ where: { id: j.categoryId, purchaseExpenses: { none: {} } } });
    });
    console.log("Откат выполнен: лоты и позиции возвращены, расходы «Образцы» удалены."); process.exit(0);
  }

  const mats = await prisma.rawMaterial.findMany({ where: { organizationId: org.id, name: { in: NAMES } }, select: { id: true, name: true, isActive: true } });
  const matIds = mats.map((m) => m.id);
  const items = await prisma.purchaseItem.findMany({ where: { rawMaterialId: { in: matIds } }, include: { purchase: { select: { id: true, orderDate: true, exchangeRate: true, status: true } }, rawMaterial: { select: { name: true } } } });
  const lotIds = items.map((i) => i.lotId).filter((x): x is string => !!x);
  const lots = await prisma.rawMaterialLot.findMany({ where: { id: { in: lotIds } } });
  const used = await prisma.productionMaterialUsage.count({ where: { lotId: { in: lotIds } } });
  if (used > 0) { console.log(`Остановка: лоты используются в ТЗ (${used} списаний).`); process.exit(1); }

  // Расход на группу «закупка × ставка НДС»: сумма без НДС в рублях, описание — состав.
  type G = { purchaseId: string; date: Date; vatRate: string; amount: number; parts: Map<string, number> };
  const groups = new Map<string, G>();
  for (const i of items) {
    const key = `${i.purchaseId}|${i.vatRate.toString()}`;
    const g = groups.get(key) ?? { purchaseId: i.purchaseId, date: i.purchase.orderDate, vatRate: i.vatRate.toString(), amount: 0, parts: new Map() };
    g.amount += Number(i.subtotal.mul(i.purchase.exchangeRate).toFixed(2));
    g.parts.set(i.rawMaterial.name, (g.parts.get(i.rawMaterial.name) ?? 0) + Number(i.quantity));
    groups.set(key, g);
  }
  const sumAmt = [...groups.values()].reduce((a, g) => a + g.amount, 0);
  console.log(`Позиций ${items.length}, лотов ${lots.length}, закупок ${new Set(items.map((i) => i.purchaseId)).size}; расход «${CATEGORY}»: ${sumAmt.toFixed(2)} ₽ без НДС (${[...groups.values()].map((g) => `${g.vatRate} %`).join(", ")}).`);
  console.log("Состав:", [...groups.values()].flatMap((g) => [...g.parts].map(([n, q]) => `${n} ${q}`)).join(", "));
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }

  const exists = await prisma.expenseCategory.findFirst({ where: { organizationId: org.id, name: CATEGORY, kind: "PURCHASE" } });
  const journal = await prisma.$transaction(async (tx) => {
    const cat = exists ?? await tx.expenseCategory.create({ data: { organizationId: org.id, name: CATEGORY, kind: "PURCHASE" } });
    const expenseIds: string[] = [], samplePurchaseIds: string[] = [];
    const src = new Map((await tx.purchase.findMany({ where: { id: { in: [...new Set(items.map((i) => i.purchaseId))] } } })).map((p) => [p.id, p]));
    const made = new Map<string, string>();
    for (const g of groups.values()) {
      // Образцы — отдельная закупка-услуга (без позиций, один расход): попадает в статью «Услуги по УПД», не в «Куплено мех».
      let pid = made.get(g.purchaseId);
      if (!pid) {
        const o = src.get(g.purchaseId)!;
        const np = await tx.purchase.create({ data: { organizationId: o.organizationId, number: `ОБР-${o.number}`, supplierId: o.supplierId, warehouseId: o.warehouseId, status: "RECEIVED", currency: "RUB",
          orderDate: o.orderDate, receivedDate: o.receivedDate ?? o.orderDate, listLabel: "образцы", notes: `Образцы из закупки ${o.number}: не мех сырья, иные расходы.` } });
        pid = np.id; made.set(g.purchaseId, pid); samplePurchaseIds.push(pid);
      }
      const e = await tx.purchaseExpense.create({ data: { purchaseId: pid, categoryId: cat.id, amount: g.amount.toFixed(2), vatRate: g.vatRate, date: g.date, description: `Образцы: ${[...g.parts].map(([n, q]) => `${n} ${q} шт.`).join(", ")} (не учитываются в шкурах сырья)` } });
      expenseIds.push(e.id);
    }
    await tx.purchaseItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await tx.rawMaterialLot.deleteMany({ where: { id: { in: lotIds } } });
    for (const m of mats) await tx.rawMaterial.update({ where: { id: m.id }, data: { isActive: false } });
    return { categoryId: cat.id, categoryCreated: !exists, expenseIds, samplePurchaseIds, materials: mats.map((m) => ({ id: m.id, isActive: m.isActive })),
      items: items.map(({ purchase: _p, rawMaterial: _r, ...row }) => row), lots };
  });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
