/**
 * Excel «Артикулы: тип меха, мех, подкладка» — один лист: Артикул, Тип меха, Мех, Подкладка (какая записана в ТЗ или «-»).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-articles-lining-simple-xlsx.ts <результат.xlsx>
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";
import { hasLiningText } from "../src/lib/article-filters";
import { canonicalFur } from "../src/lib/fur-ref";
import { getFurIndex } from "../src/lib/fur-ref-server";
import { furFromText } from "../src/lib/product-category";

// одинаковые записи в разном написании («100 % Шелк» / «100% шелк») считаем одной, показываем первую
const uniq = (xs: string[]) => { const seen = new Map<string, string>(); for (const x of xs.map((v) => v.trim()).filter(Boolean)) { const k = x.toLowerCase().replace(/\s+/g, "").replace(/ё/g, "е"); if (!seen.has(k)) seen.set(k, x); } return [...seen.values()]; };

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("usage: <результат.xlsx>");
  const { prisma } = await import("../src/lib/prisma");
  const { loadArticleFurTypes } = await import("../src/lib/article-fur-type");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const furTypes = await loadArticleFurTypes(org);
  const idx = await getFurIndex(org);
  const kindOf = (t: string | null | undefined) => canonicalFur(t, idx)?.name ?? furFromText(t);
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org, status: { not: "CANCELLED" } },
    select: { number: true, furTypeOverride: true, lining: true, materialDescription: true, productModel: { select: { id: true, name: true } }, materialUsages: { select: { rawMaterial: { select: { name: true, unit: true } } } } },
  });
  // Строка = артикул + мех + подкладка: если у артикула в разных ТЗ разный мех или подкладка, они идут отдельными строками, у каждой свои номера ТЗ.
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "").replace(/ё/g, "е");
  type G = { art: string; id: string; kind: string; furTexts: string[]; lining: string; tz: string[] };
  const groups = new Map<string, G>();
  for (const o of orders) {
    const usedFur = uniq(o.materialUsages.filter((u) => u.rawMaterial.unit !== "M").map((u) => u.rawMaterial.name));
    const text = o.materialDescription?.trim() ?? "";
    // вид меха ТЗ: ручной вид, иначе списанное сырьё, иначе текст «Материал»; нет данных — вид артикула
    const kind = o.furTypeOverride?.trim() || [...new Set(usedFur.map(kindOf).filter(Boolean))].sort().join(" + ") || kindOf(text) || furTypes.get(o.productModel.id)?.fur || "-";
    const lining = hasLiningText(o.lining) ? o.lining!.trim() : "-";
    const key = `${o.productModel.id}|${norm(kind)}|${norm(lining)}`;
    const g = groups.get(key) ?? groups.set(key, { art: o.productModel.name, id: o.productModel.id, kind, furTexts: [], lining, tz: [] }).get(key)!;
    if (text) g.furTexts.push(text); else g.furTexts.push(...usedFur);
    g.tz.push(o.number);
  }
  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Артикулы");
  ws.addRow(["Артикул", "Тип меха", "Мех", "Подкладка", "Номера ТЗ"]);
  const num = (n: string) => n;
  for (const g of [...groups.values()].sort((x, y) => x.art.localeCompare(y.art, "ru", { numeric: true }) || x.kind.localeCompare(y.kind, "ru") || x.lining.localeCompare(y.lining, "ru"))) {
    ws.addRow([g.art, g.kind, uniq(g.furTexts).join("; ") || "-", g.lining, [...new Set(g.tz)].sort((x, y) => x.localeCompare(y, "ru", { numeric: true })).join(", ")]);
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7F7" } }; c.border = { bottom: { style: "thin" } }; });
  [16, 18, 46, 40, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  await wb.xlsx.writeFile(out);
  console.log(out, groups.size);
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });
