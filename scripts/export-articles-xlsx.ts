/**
 * ТОЛЬКО ЧТЕНИЕ. Плоская Excel-таблица: артикулы, виды меха, количество сырья и подкладки, размер, стоимость и работа по каждому ТЗ.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-articles-xlsx.ts <файл.xlsx>
 * Листы: «По ТЗ» (строка = ТЗ), «По артикулам» (итоги по артикулу), «Списания по лотам» (строка = ТЗ × лот).
 * Суммы без 4% надбавки, с НДС и без НДС — отдельными колонками; надбавка 4% показана отдельной колонкой.
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("укажите путь к .xlsx");
  const { prisma } = await import("../src/lib/prisma");
  const { loadOrderRows } = await import("../src/lib/analytics-orders");
  const org = await prisma.organization.findFirstOrThrow();
  const rows = await loadOrderRows(org.id, "all" as never, "on");
  rows.sort((a, b) => (a.modelName || "").localeCompare(b.modelName || "", "ru", { numeric: true }) || a.number.localeCompare(b.number, "ru", { numeric: true }));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const STATUS = { PLANNED: "Запланировано", IN_PROGRESS: "В работе", COMPLETED: "Завершено" } as const;

  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, cols: { h: string; k: string; w: number; num?: boolean; int?: boolean }[], data: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.h, key: c.k, width: c.w, style: c.num ? { numFmt: "#,##0.00" } : c.int ? { numFmt: "#,##0" } : {} }));
    for (const d of data) ws.addRow(d);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };

  const tz = rows.map((o) => ({
    tz: o.number, wo: o.workOrderNumber ?? "", art: o.modelName, artName: o.modelLabel, cat: o.category, grp: o.categoryGroup,
    fur: o.fur, color: o.color, size: o.sizeRaw || o.size, batch: o.batchText ?? "", year: o.year ?? "", status: STATUS[o.status],
    qty: o.qty, furQty: r2(o.furQty), liningQty: r2(o.liningQty),
    furExcl: r2(o.furExcl), furIncl: r2(o.furIncl), liningExcl: r2(o.liningExcl), liningIncl: r2(o.liningIncl),
    c4Excl: r2(o.c4Excl), c4Incl: r2(o.c4Incl), exp: r2(o.expenses), work: r2(o.work),
    costExcl: r2(o.costExcl), costIncl: r2(o.costIncl),
    perUnitWork: o.qty ? r2(o.work / o.qty) : "", perUnitCost: o.qty ? r2(o.costIncl / o.qty) : "",
  }));
  sheet("По ТЗ", [
    { h: "ТЗ", k: "tz", w: 12 }, { h: "№ ТЗ заказчика", k: "wo", w: 14 }, { h: "Артикул", k: "art", w: 12 }, { h: "Название артикула", k: "artName", w: 26 },
    { h: "Категория", k: "cat", w: 16 }, { h: "Группа", k: "grp", w: 12 }, { h: "Вид меха", k: "fur", w: 18 }, { h: "Цвет", k: "color", w: 20 }, { h: "Размер", k: "size", w: 14 },
    { h: "Партия", k: "batch", w: 14 }, { h: "Год", k: "year", w: 7 }, { h: "Статус", k: "status", w: 14 },
    { h: "Изделий, шт.", k: "qty", w: 11, int: true }, { h: "Мех, шт. (шкур)", k: "furQty", w: 12, num: true }, { h: "Подкладка, м", k: "liningQty", w: 12, num: true },
    { h: "Мех, ₽ без НДС", k: "furExcl", w: 16, num: true }, { h: "Мех, ₽ с НДС", k: "furIncl", w: 16, num: true },
    { h: "Подкладка, ₽ без НДС", k: "liningExcl", w: 16, num: true }, { h: "Подкладка, ₽ с НДС", k: "liningIncl", w: 16, num: true },
    { h: "Надбавка 4%, ₽ без НДС", k: "c4Excl", w: 15, num: true }, { h: "Надбавка 4%, ₽ с НДС", k: "c4Incl", w: 15, num: true },
    { h: "Расходы ТЗ, ₽", k: "exp", w: 14, num: true }, { h: "Работа (цена работы × кол-во), ₽", k: "work", w: 18, num: true },
    { h: "Себестоимость системы, ₽ без НДС", k: "costExcl", w: 18, num: true }, { h: "Себестоимость системы, ₽ с НДС", k: "costIncl", w: 18, num: true },
    { h: "Работа на 1 изделие, ₽", k: "perUnitWork", w: 14, num: true }, { h: "Себестоимость на 1 изделие, ₽ с НДС", k: "perUnitCost", w: 16, num: true },
  ], tz);

  type Agg = { art: string; artName: string; cat: string; grp: string; furs: Set<string>; sizes: Set<string>; tz: number; qty: number; furQty: number; liningQty: number; furIncl: number; liningIncl: number; c4Incl: number; exp: number; work: number; costIncl: number; costExcl: number };
  const by = new Map<string, Agg>();
  for (const o of rows) {
    const a = by.get(o.modelName) ?? { art: o.modelName, artName: o.modelLabel, cat: o.category, grp: o.categoryGroup, furs: new Set(), sizes: new Set(), tz: 0, qty: 0, furQty: 0, liningQty: 0, furIncl: 0, liningIncl: 0, c4Incl: 0, exp: 0, work: 0, costIncl: 0, costExcl: 0 };
    a.furs.add(o.fur); (o.sizeRaw || o.size) && a.sizes.add(o.sizeRaw || o.size);
    a.tz++; a.qty += o.qty; a.furQty += o.furQty; a.liningQty += o.liningQty; a.furIncl += o.furIncl; a.liningIncl += o.liningIncl; a.c4Incl += o.c4Incl; a.exp += o.expenses; a.work += o.work; a.costIncl += o.costIncl; a.costExcl += o.costExcl;
    by.set(o.modelName, a);
  }
  sheet("По артикулам", [
    { h: "Артикул", k: "art", w: 12 }, { h: "Название артикула", k: "artName", w: 26 }, { h: "Категория", k: "cat", w: 16 }, { h: "Группа", k: "grp", w: 12 },
    { h: "Виды меха", k: "furs", w: 28 }, { h: "Размеры", k: "sizes", w: 22 }, { h: "ТЗ, шт.", k: "tz", w: 8, int: true }, { h: "Изделий, шт.", k: "qty", w: 11, int: true },
    { h: "Мех, шт. (шкур)", k: "furQty", w: 12, num: true }, { h: "Подкладка, м", k: "liningQty", w: 12, num: true },
    { h: "Мех, ₽ с НДС", k: "furIncl", w: 16, num: true }, { h: "Подкладка, ₽ с НДС", k: "liningIncl", w: 16, num: true }, { h: "Надбавка 4%, ₽ с НДС", k: "c4Incl", w: 15, num: true },
    { h: "Расходы ТЗ, ₽", k: "exp", w: 14, num: true }, { h: "Работа (цена работы × кол-во), ₽", k: "work", w: 18, num: true },
    { h: "Себестоимость системы, ₽ без НДС", k: "costExcl", w: 18, num: true }, { h: "Себестоимость системы, ₽ с НДС", k: "costIncl", w: 18, num: true },
    { h: "Работа на 1 изделие, ₽", k: "perUnitWork", w: 14, num: true },
  ], [...by.values()].map((a) => ({ ...a, furs: [...a.furs].filter(Boolean).join("; "), sizes: [...a.sizes].join("; "), furQty: r2(a.furQty), liningQty: r2(a.liningQty), furIncl: r2(a.furIncl), liningIncl: r2(a.liningIncl), c4Incl: r2(a.c4Incl), exp: r2(a.exp), work: r2(a.work), costExcl: r2(a.costExcl), costIncl: r2(a.costIncl), perUnitWork: a.qty ? r2(a.work / a.qty) : "" })));

  const lots = rows.flatMap((o) => o.lines.map((l) => ({
    tz: o.number, art: o.modelName, size: o.sizeRaw || o.size, fur: o.fur, kind: l.isLining ? "Подкладка" : "Мех", raw: l.rawName, lot: l.lotNumber ?? "", grade: l.grade ?? "", color: l.lotColor ?? l.color ?? "",
    qty: r2(l.qty), unit: l.isLining ? "м" : "шт.", excl: r2(l.excl), incl: r2(l.incl), vat: l.vat, auction: l.auction ?? "", supplier: l.supplier ?? "", year: l.purchaseYear ?? "", purchase: l.purchaseNumber ?? "",
  })));
  sheet("Списания по лотам", [
    { h: "ТЗ", k: "tz", w: 12 }, { h: "Артикул", k: "art", w: 12 }, { h: "Размер", k: "size", w: 14 }, { h: "Вид меха ТЗ", k: "fur", w: 18 }, { h: "Тип", k: "kind", w: 11 }, { h: "Материал", k: "raw", w: 24 },
    { h: "Лот", k: "lot", w: 14 }, { h: "Описание лота", k: "grade", w: 30 }, { h: "Цвет лота", k: "color", w: 18 }, { h: "Количество", k: "qty", w: 11, num: true }, { h: "Ед.", k: "unit", w: 6 },
    { h: "₽ без НДС", k: "excl", w: 14, num: true }, { h: "₽ с НДС", k: "incl", w: 14, num: true }, { h: "НДС, %", k: "vat", w: 7 },
    { h: "Аукцион", k: "auction", w: 16 }, { h: "Поставщик", k: "supplier", w: 18 }, { h: "Год закупки", k: "year", w: 10 }, { h: "Закупка", k: "purchase", w: 12 },
  ], lots);

  await wb.xlsx.writeFile(out);
  const tot = rows.reduce((t, o) => ({ qty: t.qty + o.qty, work: t.work + o.work, cost: t.cost + o.costIncl, furQty: t.furQty + o.furQty }), { qty: 0, work: 0, cost: 0, furQty: 0 });
  console.log(`ТЗ ${rows.length}, артикулов ${by.size}, строк по лотам ${lots.length}; изделий ${tot.qty}, шкур ${r2(tot.furQty)}, работа ${r2(tot.work)}, себестоимость с НДС ${r2(tot.cost)} → ${out}`);
}
main().then(() => process.exit(0));
