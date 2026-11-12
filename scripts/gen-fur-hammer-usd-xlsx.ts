/**
 * Excel «Молоток в $ по аукционам»: тип меха → год → признак меха (седина и др.); столбцы — аукционы,
 * значение — средневзвешенная цена молотка в долларах за шкуру (Σ $ ÷ Σ шт. по лотам с ценой в USD);
 * в конце — средневзвешенная по всем аукционам, у которых была цена в долларах. Лоты без аукциона (прямые у поставщика) не входят.
 * Цена $ — как на экране «Сырьё» (lotUsdPrice: только то, что записано в документах лота).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-fur-hammer-usd-xlsx.ts <файл.xlsx>
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const BR = "FFBFBFBF", NAVY = "FF2B2A5A", LAV = "FFD9D7EC", PALE = "FFF1F0F8";
const USD = '"$"#,##0.0;\\-"$"#,##0.0;"–"';
const N0 = '#,##0;\\-#,##0;"–"';

type Lot = { item: string; year: number; auction: string; attrs: string[]; usdQty: number; usdSubtotal: number; usdPrice: number | null; recv: number };

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("укажите путь файла");
  const { prisma } = await import("@/lib/prisma");
  const { loadFurLots } = await import("@/lib/fur-table-server");
  const { getFurIndex } = await import("@/lib/fur-ref-server");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const furIdx = await getFurIndex(org);
  const all = (await loadFurLots(prisma, org, { kind: "fur", year: "all", furIdx })) as unknown as (Lot & { auctionLabel: string; source?: string })[];
  // Только аукционные лоты с ценой в USD
  const lots = all.filter((l) => l.usdPrice != null && l.usdQty > 0 && l.auction && l.auction !== "__none" && !/^без аукциона$/i.test(l.auction) && l.source !== "supplier");
  console.log(`лотов меха всего ${all.length}, с ценой $ на аукционах ${lots.length}`);

  // Аукционы — столбцы: по дате (год и название), только те, где есть цена в $
  const aucKey = (l: { auctionLabel?: string; auction: string }) => l.auctionLabel || l.auction;
  const aucSet = new Map<string, { label: string; year: number; first: string }>();
  for (const l of lots) { const k = aucKey(l); const cur = aucSet.get(k); if (!cur) aucSet.set(k, { label: k, year: l.year, first: l.auction }); else cur.year = Math.min(cur.year, l.year); }
  const auctions = [...aucSet.values()].sort((a, b) => a.year - b.year || a.label.localeCompare(b.label, "ru"));

  type Cell = { q: number; s: number };
  const add = (m: Map<string, Cell>, k: string, q: number, s: number) => { const c = m.get(k) ?? { q: 0, s: 0 }; c.q += q; c.s += s; m.set(k, c); };
  // Дерево: тип → год → признак; в каждом узле — по аукционам
  const types = new Map<string, { cells: Map<string, Cell>; years: Map<number, { cells: Map<string, Cell>; attrs: Map<string, Map<string, Cell>> }> }>();
  for (const l of lots) {
    const t = types.get(l.item) ?? types.set(l.item, { cells: new Map(), years: new Map() }).get(l.item)!;
    const y = t.years.get(l.year) ?? t.years.set(l.year, { cells: new Map(), attrs: new Map() }).get(l.year)!;
    const k = aucKey(l);
    add(t.cells, k, l.usdQty, l.usdSubtotal);
    add(y.cells, k, l.usdQty, l.usdSubtotal);
    const attrs = l.attrs.length ? l.attrs : ["Без признака"];
    for (const a of attrs) { const m = y.attrs.get(a) ?? y.attrs.set(a, new Map()).get(a)!; add(m, k, l.usdQty, l.usdSubtotal); }
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Молоток $ по аукционам", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: true };
  const nC = auctions.length;
  ws.getCell(1, 1).value = "Средневзвешенная цена молотка в долларах за шкуру (Σ $ ÷ Σ шт., только лоты с ценой в USD, только аукционы)";
  ws.getCell(1, 1).font = { bold: true, size: 12 };
  ws.getCell(2, 1).value = "Тип меха → год → признак меха; у шкуры с несколькими признаками она учтена в каждом признаке (в годе и типе — один раз)";
  ws.getCell(2, 1).font = { italic: true, color: { argb: "FF666666" } };
  const head = ["Тип меха / год / признак", ...auctions.map((a) => a.label), "Средневзвешенная по всем аукционам с $-ценой", "Шкур, шт."];
  head.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(NAVY); c.alignment = { wrapText: true, vertical: "middle", horizontal: i === 0 ? "left" : "center" }; c.border = { top: { style: "thin", color: { argb: BR } }, bottom: { style: "thin", color: { argb: BR } }, left: { style: "thin", color: { argb: BR } }, right: { style: "thin", color: { argb: BR } } }; });
  ws.getRow(3).height = 62;
  ws.getColumn(1).width = 34;
  for (let i = 0; i < nC; i++) ws.getColumn(2 + i).width = 17;
  ws.getColumn(nC + 2).width = 22; ws.getColumn(nC + 3).width = 11;

  let r = 4;
  const writeRow = (label: string, level: number, cells: Map<string, Cell>, style: "type" | "year" | "attr") => {
    const row = ws.getRow(r++);
    row.outlineLevel = level;
    const a = row.getCell(1); a.value = (style === "attr" ? "      " : style === "year" ? "   " : "") + label;
    let tq = 0, ts = 0;
    auctions.forEach((au, i) => { const c = cells.get(au.label); const cell = row.getCell(2 + i); if (c && c.q > 0) { cell.value = c.s / c.q; cell.numFmt = USD; tq += c.q; ts += c.s; } else cell.value = null; cell.alignment = { horizontal: "right" }; });
    const tot = row.getCell(nC + 2); tot.value = tq > 0 ? ts / tq : null; tot.numFmt = USD; tot.font = { bold: true }; tot.alignment = { horizontal: "right" };
    const qty = row.getCell(nC + 3); qty.value = tq; qty.numFmt = N0; qty.alignment = { horizontal: "right" };
    const f = style === "type" ? { bold: true, size: 12 } : style === "year" ? { bold: true } : {};
    for (let c = 1; c <= nC + 3; c++) { const cell = row.getCell(c); cell.font = { ...(cell.font ?? {}), ...f }; if (style === "type") cell.fill = fill(LAV); else if (style === "year") cell.fill = fill(PALE); cell.border = { bottom: { style: "hair", color: { argb: BR } } }; }
    return { tq, ts };
  };

  const grand = new Map<string, Cell>();
  const typeOrder = [...types.entries()].sort((a, b) => [...b[1].cells.values()].reduce((s, c) => s + c.q, 0) - [...a[1].cells.values()].reduce((s, c) => s + c.q, 0));
  for (const [name, t] of typeOrder) {
    writeRow(name, 0, t.cells, "type");
    for (const [k, c] of t.cells) add(grand, k, c.q, c.s);
    for (const [year, y] of [...t.years.entries()].sort((a, b) => a[0] - b[0])) {
      writeRow(String(year), 1, y.cells, "year");
      for (const [attr, m] of [...y.attrs.entries()].sort((a, b) => (a[0] === "Без признака" ? 1 : b[0] === "Без признака" ? -1 : a[0].localeCompare(b[0], "ru")))) writeRow(attr, 2, m, "attr");
    }
  }
  r++;
  const g = writeRow("ИТОГО по всем типам меха", 0, grand, "type");
  void g;
  const gr = ws.getRow(r - 1); gr.eachCell((c) => { c.fill = fill(NAVY); c.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
  await wb.xlsx.writeFile(out);
  console.log(`готово: ${out}; типов ${types.size}, аукционов ${auctions.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
