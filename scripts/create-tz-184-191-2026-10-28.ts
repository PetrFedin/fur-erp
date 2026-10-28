/**
 * ТЗ № 184–191 по документу «расчёт по доплате, Партия 23, часть 1 (Доставка 1)» и счёту №289 от 21.10.2026: 17 изделий, пришедших 23.10.2026,
 * по которым ТЗ в системе ещё не было. Заводим со всеми известными данными (модель, цвет, размеры, количество, цена работы, заказчик, подрядчик, договор);
 * сырьё в документах не указано — стоимость сырья записывается ОРИЕНТИРОВОЧНО по аналогии (средняя стоимость единицы той же модели без работы)
 * отдельной строкой расходов «Сырьё по аналогии (ориентировочно)»; склад сырья НЕ трогается. Когда появятся списания — строку расходов удалить.
 * Статус «Завершено» (изделия получены), приход готовой продукции по полной себестоимости — как при завершении ТЗ в приложении.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-tz-184-191-2026-10-28.ts             # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-tz-184-191-2026-10-28.ts --apply     # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-tz-184-191-2026-10-28.ts --rollback
 *
 * M039 — модели в системе нет (создаётся по образцу M038), аналога по сырью нет: сырьё не оценивается (0), помечено в примечании.
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-create-tz-184-191-2026-10-28.json");
const D = Prisma.Decimal;
const N = (s: string) => s.replace(/[-\s]/g, "").toUpperCase().replace(/М/g, "M").replace(/А/g, "A");
const END = new Date("2026-10-23T00:00:00.000Z"); // дата прихода

type Line = { wo: string; model: string; qty: number; color: string; size: string; descr: string; work: number; apps: string };
const LINES: Line[] = [
  { wo: "184", model: "M039", qty: 1, color: "Чёрный", size: "46", descr: "Пальто норка чёрная + соболь", work: 355000, apps: "№276" },
  { wo: "185", model: "M012", qty: 7, color: "Блэкглама", size: "NS", descr: "Манишка норка блэкглама", work: 95600, apps: "№300 (2 шт.), №301 (2 шт.), №299 (3 шт.)" },
  { wo: "186", model: "M045", qty: 3, color: "Бордовый", size: "40 42 48", descr: "Жилет норка бордо", work: 180000, apps: "№272 (42), №270 (40), №269 (48)" },
  { wo: "187", model: "M046", qty: 2, color: "Коричневый", size: "42 46", descr: "Жилет соболь", work: 105000, apps: "№309 (46), №308 (42)" },
  { wo: "188", model: "M011A", qty: 1, color: "Коричневый", size: "44", descr: "Пальто норка браун", work: 225500, apps: "№283" },
  { wo: "189", model: "M026", qty: 1, color: "Белый", size: "46", descr: "Пальто норка белая + шарф", work: 320000, apps: "№199" },
  { wo: "190", model: "M023", qty: 1, color: "Бежевый", size: "44", descr: "Куртка двухсторонняя из соболя торторо, верх нейлон", work: 280000, apps: "№162" },
  { wo: "191", model: "M038", qty: 1, color: "Чёрный", size: "48", descr: "Полупальто норка чёрная стриженая + соболь", work: 187000, apps: "№287" },
];

type J = { orders: string[]; expenses: string[]; movements: string[]; stock: { id: string; quantity: string; avgUnitCost: string; created: boolean; warehouseId: string; modelId: string }[]; modelCreated: string | null; categoryCreated: string | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { fullFinishedCost, FG_FULL_COST_NOTE } = await import("../src/lib/finished-goods-cost");
  const { loadDrillOrders } = await import("../src/lib/dashboard-data");
  const prisma = createAuditedClient("script:create-tz-184-191");
  const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН", "· база", dbName);

  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: j.movements } } });
      for (const s of j.stock.slice().reverse()) {
        if (s.created) await tx.finishedGoodsStock.deleteMany({ where: { warehouseId: s.warehouseId, productModelId: s.modelId } });
        else await tx.finishedGoodsStock.updateMany({ where: { warehouseId: s.warehouseId, productModelId: s.modelId }, data: { quantity: s.quantity, avgUnitCost: s.avgUnitCost } });
      }
      await tx.productionExpense.deleteMany({ where: { id: { in: j.expenses } } });
      await tx.productionOrder.deleteMany({ where: { id: { in: j.orders } } });
      if (j.modelCreated) await tx.productModel.deleteMany({ where: { id: j.modelCreated } });
      if (j.categoryCreated) await tx.expenseCategory.deleteMany({ where: { id: j.categoryCreated } });
    });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback или перенесите журнал."); await prisma.$disconnect(); return; }

  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id } });
  const colors = await prisma.colorRef.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } });
  // аналоги: средняя стоимость единицы модели БЕЗ работы (по ТЗ в системе)
  const f = { auction: [], fur: [], color: [], attr: [], batch: [], status: [], vat: [], catgroup: [] } as never;
  const drill = await loadDrillOrders(org.id, "all", f, "on" as never, "all");
  const analog = new Map<string, { perUnit: number; qty: number }>();
  for (const o of drill) {
    if (o.cat === "Ремонт") continue;
    const mat = o.lines.reduce((s, l) => s + l.i, 0) + o.exp + o.resI; // сырьё с НДС + расходы + прочее (без работы)
    const a = analog.get(o.mid) ?? { perUnit: 0, qty: 0 };
    a.perUnit += mat; a.qty += o.qty; analog.set(o.mid, a);
  }
  const lastNo = (await prisma.productionOrder.findMany({ where: { number: { startsWith: "П-2026-" } }, select: { number: true } })).map((o) => Number(o.number.slice(7))).reduce((a, b) => Math.max(a, b), 0);

  let m39: (typeof models)[number] | null = null;
  const journal: J = { orders: [], expenses: [], movements: [], stock: [], modelCreated: null, categoryCreated: null };
  const plan: { line: Line; model: (typeof models)[number] | null; est: number; tpl: Awaited<ReturnType<typeof prisma.productionOrder.findFirst>> }[] = [];
  for (const l of LINES) {
    let model = models.find((m) => N(m.name) === N(l.model)) ?? null;
    const tpl = await prisma.productionOrder.findFirst({ where: { productModelId: model?.id ?? "-", status: "COMPLETED" }, orderBy: { number: "desc" } });
    const a = model ? analog.get(model.id) : undefined;
    const est = a && a.qty > 0 ? (a.perUnit / a.qty) * l.qty : 0;
    plan.push({ line: l, model, est, tpl });
  }
  for (const [i, x] of plan.entries()) {
    console.log(`ТЗ ${x.line.wo} → П-2026-${String(lastNo + 1 + i).padStart(4, "0")} | ${x.line.model}${x.model ? "" : " (модели нет — создаю по образцу M038)"} ×${x.line.qty} | ${x.line.color} ${x.line.size} | работа ${x.line.work} ₽/шт | сырьё по аналогии ${Math.round(x.est).toLocaleString("ru-RU")} ₽`);
  }
  if (!APPLY) { console.log("Пробный прогон: БД не менялась."); await prisma.$disconnect(); return; }

  const tplAny = plan.find((x) => x.tpl)!.tpl!;
  await prisma.$transaction(async (tx) => {
    let cat = await tx.expenseCategory.findFirst({ where: { organizationId: org.id, name: "Сырьё по аналогии (ориентировочно)" } });
    if (!cat) { cat = await tx.expenseCategory.create({ data: { organizationId: org.id, name: "Сырьё по аналогии (ориентировочно)", kind: "PRODUCTION" } }); journal.categoryCreated = cat.id; }
    for (const [i, x] of plan.entries()) {
      let model = x.model;
      if (!model) {
        const src = models.find((m) => N(m.name) === "M038")!;
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
        model = await tx.productModel.create({ data: { ...rest, name: x.line.model, salesCode: x.line.model, aliases: [`${x.line.model}/MINK SHAVED + SABLE WILD`], sellingPrice: null, supplierWorkPrice: new D(x.line.work), attributes: Prisma.JsonNull } as never });
        journal.modelCreated = model.id; m39 = model;
      }
      const tpl = x.tpl ?? tplAny;
      const colorRef = colors.find((c) => c.name === x.line.color);
      const qty = new D(x.line.qty);
      const est = new D(Math.round(x.est * 100) / 100);
      const notes = [
        `ТЗ №${x.line.wo}: создано по расчёту по доплате «Партия 23, часть 1» (Доставка 1), приложения ${x.line.apps}; счёт №289 от 21.10.2026 (Веллмех, доплата 1 693 860 ₽).`,
        `Данные неполные: списания сырья, подкладка и размеры не внесены. Стоимость сырья ${x.est > 0 ? "записана ОРИЕНТИРОВОЧНО по аналогии (средняя стоимость единицы модели без работы)" : "НЕ оценена (аналога по модели нет)"} строкой расходов «Сырьё по аналогии (ориентировочно)» — удалить при внесении фактических списаний.`,
      ].join("\n");
      const order = await tx.productionOrder.create({
        data: {
          organizationId: org.id, number: `П-2026-${String(lastNo + 1 + i).padStart(4, "0")}`, productModelId: model.id,
          rawWarehouseId: tpl.rawWarehouseId, finishedWarehouseId: tpl.finishedWarehouseId, status: "COMPLETED",
          plannedQuantity: qty, producedQuantity: qty, color: x.line.color, colorRefId: colorRef?.id ?? null, size: x.line.size,
          materialDescription: x.line.descr, lining: tpl.lining, endDate: END, notes,
          clientId: tpl.clientId, contractNumber: tpl.contractNumber, contractorId: tpl.contractorId,
          workOrderNumber: x.line.wo, clientWorkPricePerUnit: new D(x.line.work),
          materialCost: new D(0), expenseCost: est, totalCost: est, unitCost: est.div(qty),
        },
      });
      journal.orders.push(order.id);
      if (est.gt(0)) {
        const ex = await tx.productionExpense.create({ data: { productionOrderId: order.id, categoryId: cat.id, amount: est, date: END, description: "ориентировочно по аналогии с прежними ТЗ модели" } });
        journal.expenses.push(ex.id);
      }
      const full = fullFinishedCost({ materialUsages: [], expenses: est.gt(0) ? [{ amount: est }] : [], clientWorkPricePerUnit: new D(x.line.work) } as never, qty);
      const mv = await tx.finishedGoodsMovement.create({ data: { organizationId: org.id, warehouseId: order.finishedWarehouseId, productModelId: model.id, type: "PRODUCTION_IN", quantity: qty, unitCost: full.total.div(qty), totalCost: full.total, productionOrderId: order.id, notes: FG_FULL_COST_NOTE, date: END } });
      journal.movements.push(mv.id);
      const ex = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: model.id } } });
      if (!ex) { await tx.finishedGoodsStock.create({ data: { organizationId: org.id, warehouseId: order.finishedWarehouseId, productModelId: model.id, quantity: qty, avgUnitCost: full.total.div(qty) } }); journal.stock.push({ id: "", quantity: "0", avgUnitCost: "0", created: true, warehouseId: order.finishedWarehouseId, modelId: model.id }); }
      else {
        journal.stock.push({ id: ex.id, quantity: ex.quantity.toString(), avgUnitCost: ex.avgUnitCost.toString(), created: false, warehouseId: order.finishedWarehouseId, modelId: model.id });
        const nq = ex.quantity.add(qty);
        await tx.finishedGoodsStock.update({ where: { id: ex.id }, data: { quantity: nq, avgUnitCost: ex.quantity.mul(ex.avgUnitCost).add(full.total).div(nq) } });
      }
    }
  });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  console.log(`Создано ТЗ: ${journal.orders.length}${m39 ? ", модель M039 создана" : ""}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
