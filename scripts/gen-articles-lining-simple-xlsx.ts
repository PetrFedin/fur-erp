/**
 * Excel «Артикулы: тип меха, мех, подкладка» — один лист: Артикул, Тип меха, Мех, Подкладка (какая записана в ТЗ или «-»).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-articles-lining-simple-xlsx.ts <результат.xlsx>
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";
import { hasLiningText } from "../src/lib/article-filters";

// одинаковые записи в разном написании («100 % Шелк» / «100% шелк») считаем одной, показываем первую
const uniq = (xs: string[]) => { const seen = new Map<string, string>(); for (const x of xs.map((v) => v.trim()).filter(Boolean)) { const k = x.toLowerCase().replace(/\s+/g, "").replace(/ё/g, "е"); if (!seen.has(k)) seen.set(k, x); } return [...seen.values()]; };

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("usage: <результат.xlsx>");
  const { prisma } = await import("../src/lib/prisma");
  const { loadArticleFurTypes } = await import("../src/lib/article-fur-type");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const furTypes = await loadArticleFurTypes(org);
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org, status: { not: "CANCELLED" } },
    select: { lining: true, materialDescription: true, productModel: { select: { id: true, name: true } }, materialUsages: { select: { rawMaterial: { select: { name: true, unit: true } } } } },
  });
  type A = { name: string; fur: string[]; lining: string[] };
  const by = new Map<string, A>();
  for (const o of orders) {
    const a = by.get(o.productModel.id) ?? by.set(o.productModel.id, { name: o.productModel.name, fur: [], lining: [] }).get(o.productModel.id)!;
    if (o.materialDescription) a.fur.push(o.materialDescription);
    else for (const u of o.materialUsages) if (u.rawMaterial.unit !== "M") a.fur.push(u.rawMaterial.name);
    if (hasLiningText(o.lining)) a.lining.push(o.lining!);
  }
  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Артикулы");
  ws.addRow(["Артикул", "Тип меха", "Мех", "Подкладка"]);
  for (const [id, a] of [...by].sort((x, y) => x[1].name.localeCompare(y[1].name, "ru", { numeric: true }))) {
    ws.addRow([a.name, furTypes.get(id)?.fur ?? "-", uniq(a.fur).join("; ") || "-", uniq(a.lining).join("; ") || "-"]);
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7F7" } }; c.border = { bottom: { style: "thin" } }; });
  [16, 18, 46, 40].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  await wb.xlsx.writeFile(out);
  console.log(out, by.size);
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });
