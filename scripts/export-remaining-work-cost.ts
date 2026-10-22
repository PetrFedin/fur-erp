// Excel: что ещё не пришло по заказу FW 26/27 (Conf − поступило) и сколько выйдет работа по прежним ценам модели.
// Новых артикулов (по модели ещё не было ТЗ с ценой работы) цену не придумываем — ячейка пустая.
//   node --env-file=.env node_modules/.bin/tsx scripts/export-remaining-work-cost.ts <out.xlsx>
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();
type Row = { acode: string; modelCode: string | null; fw26Conf?: number; fw26Deliv?: number };

async function main() {
  const out = process.argv[2]; if (!out) throw new Error("укажите путь файла");
  const st = await prisma.systemState.findFirst({ where: { key: "sales-report-sizes:2026-10-19" } });
  const rows = ((st?.value as { rows: Row[] }).rows);
  const lines = await prisma.salesReceiptLine.findMany({ select: { article: true, modelCode: true, level2: true, level3: true, level4: true, level5: true } });
  const lv = new Map<string, string[]>(), lvModel = new Map<string, string[]>();
  for (const l of lines) {
    const v = [l.level2, l.level3, l.level4, l.level5].map((x) => x || "");
    if (!lv.has(l.article)) lv.set(l.article, v);
    if (l.modelCode && !lvModel.has(l.modelCode)) lvModel.set(l.modelCode, v);
  }
  const orders = await prisma.productionOrder.findMany({ where: { clientWorkPricePerUnit: { not: null } }, select: { plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, number: true, status: true, productModel: { select: { salesCode: true, sku: true, category: true } } }, orderBy: { number: "asc" } });
  const norm = (c: string) => c.replace(/[-\s]/g, "").toUpperCase();
  const rate = new Map<string, { qty: number; sum: number; last: number; min: number; max: number; n: number }>();
  for (const o of orders) {
    const code = o.productModel.salesCode || o.productModel.sku; const p = Number(o.clientWorkPricePerUnit);
    if (!code || !(p > 0)) continue;
    const q = Number(o.producedQuantity) > 0 ? Number(o.producedQuantity) : Number(o.plannedQuantity);
    const r = rate.get(norm(code)) ?? { qty: 0, sum: 0, last: p, min: p, max: p, n: 0 };
    r.qty += q; r.sum += q * p; r.last = p; r.min = Math.min(r.min, p); r.max = Math.max(r.max, p); r.n++; rate.set(norm(code), r);
  }
  const catOf = new Map<string, string>();
  for (const o of orders) { const c = o.productModel.salesCode || o.productModel.sku; if (c && o.productModel.category) catOf.set(norm(c), o.productModel.category); }
  // Новые артикулы без строк прихода: категория и описание со слов владельца (22.10).
  const MANUAL: Record<string, [string, string, string]> = {
    M030: ["Одежда меховая", "Шубы", "шуба однобортная"], M039: ["Одежда меховая", "Шубы", "шуба удлинённая"], M040: ["Одежда меховая", "Шубы", "шуба удлинённая"],
    M054: ["Одежда меховая", "Шубы", "шуба удлинённая"], M058: ["Одежда меховая", "Шубы", "шуба укороченная"], M059: ["Одежда меховая", "Шубы", "шуба укороченная"], "MCF02": ["Манжеты", "Манжеты", "манжеты"],
  };
  const FUR: [RegExp, string][] = [[/SABLE/, "Соболь"], [/MINK/, "Норка"], [/LYNX/, "Рысь"], [/FOX/, "Лиса"], [/KARAKUL|SWAKARA/, "Свакара"]];
  const furKey = (acode: string) => { const u = acode.toUpperCase(); return FUR.filter(([re]) => re.test(u)).map(([, n]) => n).sort().join(" + "); };
  // Пул ориентиров: артикулы с известной ценой работы модели (мех, категория 4, категория 5, цена).
  const pool = new Map<string, { fur: string; l4: string; l5: string; rate: number; model: string }>();
  for (const l of lines) {
    const m = norm(l.modelCode ?? l.article.split("/")[0]); const r = rate.get(m); if (!r) continue;
    if (!pool.has(l.article)) pool.set(l.article, { fur: furKey(l.article), l4: l.level4 || "", l5: l.level5 || "", rate: r.sum / r.qty, model: m });
  }
  const estimate = (fur: string, l4: string, l5: string) => {
    const tries: [string, (p: { fur: string; l4: string; l5: string }) => boolean][] = [
      ["мех + категории 1–3", (p) => p.fur === fur && p.l4 === l4 && p.l5.toLowerCase().replace(/ё/g, "е") === l5.toLowerCase().replace(/ё/g, "е")],
      ["мех + категория 2", (p) => p.fur === fur && p.l4 === l4],
      ["категория 2 (мех любой)", (p) => p.l4 === l4],
    ];
    for (const [what, f] of tries) {
      const byModel = new Map<string, number>();
      for (const p of pool.values()) if (f(p) && p.fur !== "" ) byModel.set(p.model, p.rate);
      if (what.startsWith("категория 2") ) for (const p of pool.values()) if (f(p)) byModel.set(p.model, p.rate);
      const v = [...byModel.values()]; if (v.length) return { avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length, what, min: Math.min(...v), max: Math.max(...v) };
    }
    return null;
  };
  const art = new Map<string, { acode: string; modelCode: string; left: number }>();
  for (const r of rows) {
    const d = (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0); if (d <= 0) continue;
    const a = art.get(r.acode) ?? { acode: r.acode, modelCode: r.modelCode ?? r.acode.split("/")[0], left: 0 }; a.left += d; art.set(r.acode, a);
  }
  const list = [...art.values()].map((a) => {
    const man = MANUAL[norm(a.modelCode)];
    const v = man ? ["", man[0], man[1], ""] : lv.get(a.acode) ?? lvModel.get(a.modelCode) ?? ["", "", "", ""];
    const r = rate.get(norm(a.modelCode)); const avg = r ? r.sum / r.qty : null;
    const est = avg == null ? estimate(furKey(a.acode), v[2] || "", man ? man[2] : v[3] || "") : null;
    return { est, c3: man ? man[2][0].toUpperCase() + man[2].slice(1) : v[3] || "", c1: v[1] || v[0] || catOf.get(norm(a.modelCode)) || "(без категории)", c2: v[2] || "", a, avg, r };
  }).sort((x, y) => x.c1.localeCompare(y.c1, "ru") || x.c2.localeCompare(y.c2, "ru") || x.a.acode.localeCompare(y.a.acode));

  if (process.env.DUMP_JSON) {
    const ret = await prisma.systemState.findFirst({ where: { key: "retail-prices:2026-10-19" } });
    const rr = (ret?.value as { rows: { acode: string; modelCode: string | null; price: number }[] }).rows;
    const clsOf = new Map(rows.map((r) => [r.acode, (r as unknown as { cls: string }).cls]));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.DUMP_JSON, JSON.stringify({ retail: rr, items: list.map((x) => ({ acode: x.a.acode, model: x.a.modelCode, cls: clsOf.get(x.a.acode), c2: x.c2, fur: furKey(x.a.acode), left: x.a.left, rate: x.avg, est: x.est ? x.est.avg : null, estWhat: x.est ? `${x.est.what}: ${x.est.n} мод.` : null })) }));
  }
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Работа на остаток заказа");
  ws.columns = [{ header: "Категория 1", width: 22 }, { header: "Категория 2", width: 22 }, { header: "Категория 3", width: 24 }, { header: "Артикул", width: 38 }, { header: "Осталось получить, шт.", width: 14 }, { header: "Цена работы, ₽/шт.", width: 16 }, { header: "Работа на остаток, ₽", width: 18 }, { header: "Ориентир по меху и категории, ₽/шт. (только где нет цены)", width: 22 }, { header: "Ориентир на остаток, ₽", width: 18 }, { header: "Основание ориентира", width: 52 }, { header: "Основание", width: 44 }];
  ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  list.forEach((x, i) => {
    const n = i + 2;
    ws.addRow([x.c1, x.c2, x.c3, x.a.acode, x.a.left, x.avg == null ? null : Math.round(x.avg), x.avg == null ? null : { formula: `E${n}*F${n}`, result: Math.round(x.avg) * x.a.left }, x.est ? Math.round(x.est.avg) : null, x.est ? { formula: `E${n}*H${n}`, result: Math.round(x.est.avg) * x.a.left } : null, x.est ? `${x.est.what}: среднее по ${x.est.n} мод., от ${Math.round(x.est.min).toLocaleString("ru")} до ${Math.round(x.est.max).toLocaleString("ru")}` : x.avg == null ? "похожих нет" : "", x.r ? `среднее по ${x.r.n} ТЗ модели ${x.a.modelCode}${x.r.min !== x.r.max ? `, от ${x.r.min.toLocaleString("ru")} до ${x.r.max.toLocaleString("ru")}` : ""}` : `новая модель ${x.a.modelCode} (${MANUAL[norm(x.a.modelCode)]?.[2] ?? ""}): ТЗ с ценой работы не было`]);
  });
  const t = list.length + 2;
  ws.addRow(["Всего", "", "", "", { formula: `SUM(E2:E${t - 1})`, result: list.reduce((s, x) => s + x.a.left, 0) }, "", { formula: `SUM(G2:G${t - 1})`, result: 0 }, "", { formula: `SUM(I2:I${t - 1})`, result: 0 }, "", `новых (без цены): ${list.filter((x) => x.avg == null).length} арт., ${list.filter((x) => x.avg == null).reduce((s, x) => s + x.a.left, 0)} шт.`]).font = { bold: true };
  for (const c of ["E", "F", "G", "H", "I"]) ws.getColumn(c).numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = `A1:K${t - 1}`;
  await wb.xlsx.writeFile(out);
  const priced = list.filter((x) => x.avg != null);
  console.log(`артикулов ${list.length}, штук ${list.reduce((s, x) => s + x.a.left, 0)}; с ценой ${priced.length} арт. / ${priced.reduce((s, x) => s + x.a.left, 0)} шт.; сумма ${Math.round(priced.reduce((s, x) => s + Math.round(x.avg!) * x.a.left, 0))}; без цены ${list.length - priced.length}`);
}
main().finally(() => prisma.$disconnect());
