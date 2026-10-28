/**
 * Заполнение ТЗ № 184–189 данными из приложений к договору подряда №1605 (docx от 26.08.2026): цвет, размеры, материал, подкладка, цена работы,
 * дата ТЗ, материалы заказчика (лоты, количества, цены), срок, условия оплаты. Стоимость сырья вместо оценки «по аналогии» берётся из документа
 * (ИТОГО по материалам, с НДС 22 %): сумма — в снимок ТЗ (materialCost/totalCost), строка расходов «Материалы заказчика по документу ТЗ» — без НДС
 * (чтобы режимы «с НДС» / «без НДС» на Главной считались верно). Лоты на складе НЕ списываются (как у ТЗ № 183): список лотов записан в примечание.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-tz-184-189-from-docs-2026-10-28.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-tz-184-189-from-docs-2026-10-28.ts --apply    # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-tz-184-189-from-docs-2026-10-28.ts --rollback
 *   --dir=/путь  — папка с docx (по умолчанию ~/Downloads)
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? join(homedir(), "Downloads");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-fill-tz-184-189-2026-10-28.json");
const D = Prisma.Decimal;
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** Текст docx: ячейки таблиц через « | », абзацы — переводом строки. */
function docxText(file: string): string {
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8", maxBuffer: 20_000_000 });
  return xml.replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n\s*\n+/g, "\n");
}

type Parsed = {
  wo: string; date: string; items: { name: string; color: string; model: string; material: string; size: string; lining: string; qty: number; work: number; price: number }[];
  mats: { name: string; lot: string; unit: string; qty: number; unitEx: number; total: number }[]; matsTotal: number; docTotal: number; deadline: string;
};

function parse(text: string): Parsed {
  const wo = /ТЕХНИЧЕСКОЕ ЗАДАНИЕ №\s*(\d+)/.exec(text)![1];
  const date = /(\d{2})\.(\d{2})\.(\d{4})\s*г/.exec(text)!;
  const lines = text.split("\n").map((l) => l.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "").trim()).filter(Boolean);
  // позиции: после «ИТОГО в руб. в т.ч. НДС 22%» идут группами по 10 ячеек: №, наименование, цвет, модель, материал, размер, подкладка, кол-во, работа, цена, итого → 11
  const iHead = lines.findIndex((l) => l.startsWith("ИТОГО в руб. в т.ч. НДС"));
  const iTot = lines.findIndex((l, i) => i > iHead && l.startsWith("Итого:"));
  const flat = lines.slice(iHead + 1, iTot).map((l) => l.replace(/\s*\|\s*/g, ""));
  const items: Parsed["items"] = [];
  for (let i = 0; i + 10 < flat.length; i += 11) items.push({ name: flat[i + 1], color: flat[i + 2].trim(), model: flat[i + 3], material: flat[i + 4], size: flat[i + 5], lining: flat[i + 6], qty: num(flat[i + 7]), work: num(flat[i + 8]), price: num(flat[i + 9]) });
  // материалы: после «Общая стоимость товаров в т.ч. НДС 22%» группами по 7: наименование, лот, ед., кол-во, цена без НДС, НДС, итого
  const iM = lines.findIndex((l) => l.startsWith("Общая стоимость товаров"));
  const iMT = lines.findIndex((l, i) => i > iM && l.startsWith("ИТОГО:"));
  const mflat = lines.slice(iM + 1, iMT).map((l) => l.replace(/\s*\|\s*/g, ""));
  const mats: Parsed["mats"] = [];
  // Строка материала: [наименование] [лот, если есть] [Шт./М.п.] [кол-во] [цена без НДС] [22%] [итого]; пустые ячейки в тексте пропадают, поэтому якорь — единица измерения.
  for (let k = 2; k + 4 < mflat.length; k++) {
    if (mflat[k] !== "Шт." && mflat[k] !== "М.п.") continue;
    const hasName = /\s/.test(mflat[k - 1]);
    mats.push({ name: hasName ? mflat[k - 1] : mflat[k - 2], lot: hasName ? "" : mflat[k - 1], unit: mflat[k], qty: num(mflat[k + 1]), unitEx: num(mflat[k + 2]), total: num(mflat[k + 4]) });
  }
  const matsTotal = num(lines.slice(iMT, iMT + 10).map((l) => l.replace(/\s*\|\s*/g, "")).find((l) => /^\d[\d\s]*[,.]\d{2}$/.test(l))!);
  const docTotal = num(/составляет\s+([\d.,]+)\s+рублей/.exec(text)![1]);
  const deadline = /не позднее\s+(\d{2}\.\d{2}\.\d{4})/.exec(text)?.[1] ?? "";
  return { wo, date: `${date[3]}-${date[2]}-${date[1]}`, items, mats, matsTotal, docTotal, deadline };
}

type J = { orders: { id: string; before: Record<string, unknown>; expenseIds: string[]; delExpenses: { categoryId: string; amount: string; date: string; description: string | null }[]; movement: { id: string; totalCost: string; unitCost: string } | null; stock: { id: string; quantity: string; avgUnitCost: string } | null }[]; categoryCreated: string | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { fullFinishedCost } = await import("../src/lib/finished-goods-cost");
  const prisma = createAuditedClient("script:fill-tz-184-189");
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      for (const o of j.orders.slice().reverse()) {
        await tx.productionExpense.deleteMany({ where: { id: { in: o.expenseIds } } });
        for (const e of o.delExpenses) await tx.productionExpense.create({ data: { productionOrderId: o.id, categoryId: e.categoryId, amount: e.amount, date: new Date(e.date), description: e.description } });
        await tx.productionOrder.update({ where: { id: o.id }, data: o.before as never });
        if (o.movement) await tx.finishedGoodsMovement.update({ where: { id: o.movement.id }, data: { totalCost: o.movement.totalCost, unitCost: o.movement.unitCost } });
        if (o.stock) await tx.finishedGoodsStock.update({ where: { id: o.stock.id }, data: { quantity: o.stock.quantity, avgUnitCost: o.stock.avgUnitCost } });
      }
      if (j.categoryCreated) await tx.expenseCategory.deleteMany({ where: { id: j.categoryCreated } });
    });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); await prisma.$disconnect(); return; }

  const files = readdirSync(DIR).filter((f) => /^ПРИЛОЖЕНИЕ.{0,3}(184|185|186|187|188|189)\D.*\.docx$/i.test(f.normalize("NFC")) || /^ПРИЛОЖЕНИЕ[ _](184|185|186|187|188|189)[ _(]/.test(f.normalize("NFC")));
  const docs = files.map((f) => parse(docxText(join(DIR, f))));
  docs.sort((a, b) => Number(a.wo) - Number(b.wo));
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  let cat = await prisma.expenseCategory.findFirst({ where: { organizationId: org.id, name: "Материалы заказчика по документу ТЗ" } });
  const journal: J = { orders: [], categoryCreated: null };

  for (const doc of docs) {
    const order = await prisma.productionOrder.findFirst({ where: { organizationId: org.id, workOrderNumber: doc.wo }, include: { expenses: true } });
    if (!order) { console.log(`ТЗ ${doc.wo}: в системе нет — пропуск`); continue; }
    const qty = doc.items.reduce((s, i) => s + i.qty, 0);
    if (!new D(qty).eq(order.plannedQuantity)) { console.log(`ТЗ ${doc.wo}: количество в документе ${qty} ≠ в системе ${order.plannedQuantity} — пропуск`); continue; }
    const first = doc.items[0];
    const sizes = Array.from(new Set(doc.items.map((i) => i.size))).join(" ");
    const matsIncl = doc.matsTotal;
    const matsEx = matsIncl / 1.22;
    const lotLines = doc.mats.map((m) => `• ${m.name}${m.lot ? ` (лот ${m.lot})` : ""}: ${m.qty} ${m.unit} × ${m.unitEx.toLocaleString("ru-RU")} ₽ без НДС = ${m.total.toLocaleString("ru-RU")} ₽ с НДС 22 %`).join("\n");
    const notes = [
      `ТЗ №${doc.wo} от ${doc.date.split("-").reverse().join(".")}: данные внесены из приложения к Договору подряда №1605 (docx). Расчёт по доплате «Партия 23, часть 1», счёт №289 от 21.10.2026.`,
      `Изделие: ${first.name}; цвет ${first.color}; модель ${first.model}; материал ${first.material}; размеры ${sizes}; подкладка ${first.lining}. Цена работы ${first.work.toLocaleString("ru-RU")} ₽/шт., стоимость продукции ${first.price.toLocaleString("ru-RU")} ₽/шт. (с НДС 22 %). Итого по ТЗ ${doc.docTotal.toLocaleString("ru-RU")} ₽.`,
      `Материалы заказчика (на склад не списаны, как у ТЗ №183):\n${lotLines}\nИтого материалы: ${matsIncl.toLocaleString("ru-RU")} ₽ с НДС 22 %.`,
      `Срок завершения работ: до ${doc.deadline}. Оплата: аванс 70 %, доплата по готовности. Поставка: Коптево, Приёмный склад Оптика, силами подрядчика.`,
    ].join("\n");
    console.log(`ТЗ ${doc.wo} (${order.number}): ${first.model} ${qty} шт., ${first.color}, размеры ${sizes}, работа ${first.work}, материалы ${matsIncl.toLocaleString("ru-RU")} ₽ (без НДС ${Math.round(matsEx).toLocaleString("ru-RU")}), позиций материалов ${doc.mats.length}; было расходов ${order.expenses.length}`);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      if (!cat) { cat = await tx.expenseCategory.create({ data: { organizationId: org.id, name: "Материалы заказчика по документу ТЗ", kind: "PRODUCTION" } }); journal.categoryCreated = cat.id; }
      const entry: J["orders"][number] = {
        id: order.id,
        before: { color: order.color, colorRefId: order.colorRefId, size: order.size, materialDescription: order.materialDescription, lining: order.lining, notes: order.notes, workOrderDate: order.workOrderDate, clientWorkPricePerUnit: order.clientWorkPricePerUnit?.toString() ?? null, materialCost: order.materialCost?.toString() ?? null, expenseCost: order.expenseCost?.toString() ?? null, totalCost: order.totalCost?.toString() ?? null, unitCost: order.unitCost?.toString() ?? null },
        expenseIds: [], delExpenses: order.expenses.map((e) => ({ categoryId: e.categoryId, amount: e.amount.toString(), date: e.date.toISOString(), description: e.description })), movement: null, stock: null,
      };
      await tx.productionExpense.deleteMany({ where: { productionOrderId: order.id } });
      const colorName = first.color.replace(/^Бордо$/i, "Бордовый").replace(/^Черный$/i, "Чёрный");
      const colorRef = await tx.colorRef.findFirst({ where: { organizationId: org.id, name: { equals: colorName, mode: "insensitive" } } });
      const ex = await tx.productionExpense.create({ data: { productionOrderId: order.id, categoryId: cat.id, amount: new D(matsEx.toFixed(2)), date: new Date(doc.date + "T00:00:00.000Z"), description: `материалы заказчика по документу ТЗ №${doc.wo} (без НДС; с НДС 22 % ${matsIncl.toLocaleString("ru-RU")} ₽)` } });
      entry.expenseIds.push(ex.id);
      const mCost = new D(matsIncl.toFixed(2)), q = new D(qty);
      await tx.productionOrder.update({
        where: { id: order.id },
        data: { color: colorName, colorRefId: colorRef?.id ?? order.colorRefId, size: sizes, materialDescription: first.material, lining: first.lining, workOrderDate: new Date(doc.date + "T00:00:00.000Z"), clientWorkPricePerUnit: new D(first.work), materialCost: mCost, expenseCost: new D(0), totalCost: mCost, unitCost: mCost.div(q), notes },
      });
      const mv = await tx.finishedGoodsMovement.findFirst({ where: { productionOrderId: order.id, type: "PRODUCTION_IN" } });
      if (mv) {
        const full = fullFinishedCost({ materialUsages: [], expenses: [{ amount: new D(matsIncl.toFixed(2)) }], clientWorkPricePerUnit: new D(first.work) } as never, q);
        entry.movement = { id: mv.id, totalCost: mv.totalCost.toString(), unitCost: mv.unitCost.toString() };
        await tx.finishedGoodsMovement.update({ where: { id: mv.id }, data: { totalCost: full.total, unitCost: full.total.div(q) } });
        const st = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: mv.warehouseId, productModelId: mv.productModelId } } });
        if (st && st.quantity.gt(0)) {
          entry.stock = { id: st.id, quantity: st.quantity.toString(), avgUnitCost: st.avgUnitCost.toString() };
          const newVal = st.quantity.mul(st.avgUnitCost).sub(mv.totalCost).add(full.total);
          await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { avgUnitCost: newVal.div(st.quantity) } });
        }
      }
      journal.orders.push(entry);
    });
  }
  if (APPLY) { writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); console.log("Журнал:", JOURNAL); } else console.log("Пробный прогон: БД не менялась.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
