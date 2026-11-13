/**
 * Excel «Молоток в $ по аукционам»: тип меха → признак меха (седина и др.); столбцы — аукционы,
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

type Lot = { item: string; color: string; year: number; auction: string; attrs: string[]; usdQty: number; usdSubtotal: number; usdPrice: number | null; recv: number };

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
  // Столбец — аукцион целиком, без дат: все СП вместе, все РП, все SAGA и т. д. (первое слово названия: «СП 03.25» → «СП»)
  const aucKey = (l: { auctionLabel?: string; auction: string }) => {
    const w = (l.auctionLabel || l.auction).trim().split(/\s+/)[0].replace(/[.,;:]+$/, "");
    return /^спец/i.test(w) ? "СП" : w;
  };
  const aucSet = new Map<string, { label: string; year: number; first: string }>();
  for (const l of lots) { const k = aucKey(l); const cur = aucSet.get(k); if (!cur) aucSet.set(k, { label: k, year: l.year, first: l.auction }); else cur.year = Math.min(cur.year, l.year); }
  const qtyBy = new Map<string, number>(); for (const l of lots) qtyBy.set(aucKey(l), (qtyBy.get(aucKey(l)) ?? 0) + l.usdQty);
  const auctions = [...aucSet.values()].sort((a, b) => (qtyBy.get(b.label) ?? 0) - (qtyBy.get(a.label) ?? 0));

  type Cell = { q: number; s: number };
  const add = (m: Map<string, Cell>, k: string, q: number, s: number) => { const c = m.get(k) ?? { q: 0, s: 0 }; c.q += q; c.s += s; m.set(k, c); };
  const years = [...new Set(lots.map((l) => l.year))].sort((a, b) => a - b);
  const NO_COLOR = "Цвет не указан", NO_ATTR = "Без признака";
  const colorOf = (l: Lot) => (!l.color || l.color === "Не указан" ? [NO_COLOR] : [l.color]);
  // «Седина» без номера не показываем: у лотов с сединой номер всегда есть («Седина 3»), общая «Седина» его только дублирует; нет номера — «Без признака».
  const attrsOf = (l: Lot) => { const own = l.attrs.filter((x) => x !== "Седина"); return own.length ? own : [NO_ATTR]; };

  type Node = { cells: Map<string, Cell>; kids: Map<string, Map<string, Cell>> };
  // Дерево: тип меха → уровень 1 → уровень 2; ключ ячейки «аукцион|год»
  const buildTree = (l1: (l: Lot) => string[], l2: (l: Lot) => string[]) => {
    const types = new Map<string, { cells: Map<string, Cell>; kids: Map<string, Node> }>();
    for (const l of lots) {
      const t = types.get(l.item) ?? types.set(l.item, { cells: new Map(), kids: new Map() }).get(l.item)!;
      const k = `${aucKey(l)}|${l.year}`;
      add(t.cells, k, l.usdQty, l.usdSubtotal);
      for (const a of l1(l)) {
        const n1 = t.kids.get(a) ?? t.kids.set(a, { cells: new Map(), kids: new Map() }).get(a)!;
        add(n1.cells, k, l.usdQty, l.usdSubtotal);
        for (const b of l2(l)) add(n1.kids.get(b) ?? n1.kids.set(b, new Map()).get(b)!, k, l.usdQty, l.usdSubtotal);
      }
    }
    return types;
  };

  const wb = new ExcelJS.Workbook();
  const border = { top: { style: "thin", color: { argb: BR } }, bottom: { style: "thin", color: { argb: BR } }, left: { style: "thin", color: { argb: BR } }, right: { style: "thin", color: { argb: BR } } } as const;
  const per = 1 + years.length; // столбцов на блок: «Итого» + годы
  const blocks = [...auctions.map((a) => a.label), "По всем аукционам с $-ценой"];
  const lastCol = 1 + blocks.length * per + 1;

  const makeSheet = (title: string, head1: string, tree: ReturnType<typeof buildTree>, noteLevels: string) => {
    const ws = wb.addWorksheet(title, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    ws.properties.outlineLevelCol = 1; ws.properties.outlineLevelRow = 2;
    ws.getCell(1, 1).value = "Средневзвешенная цена молотка в долларах за шкуру (Σ $ ÷ Σ шт., только лоты с ценой в USD, только аукционы)";
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).value = `Столбцы — аукционы целиком (все СП, все РП, все SAGA… вместе); у каждого слева итог за все годы, справа годы (свёрнуты, раскрываются плюсом над столбцами). ${noteLevels}; у шкуры с несколькими признаками она учтена в каждом признаке (в типе — один раз)`;
    ws.getCell(2, 1).font = { italic: true, color: { argb: "FF666666" } };
    const hdr = (r: number, c: number, v: string) => { const cell = ws.getCell(r, c); cell.value = v; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = fill(NAVY); cell.alignment = { wrapText: true, vertical: "middle", horizontal: c === 1 ? "left" : "center" }; cell.border = border; };
    hdr(3, 1, head1); hdr(4, 1, "");
    blocks.forEach((b, bi) => {
      const c0 = 2 + bi * per;
      for (let j = 0; j < per; j++) { hdr(3, c0 + j, j === 0 ? b : ""); hdr(4, c0 + j, j === 0 ? "Итого" : String(years[j - 1])); }
      ws.mergeCells(3, c0, 3, c0 + per - 1);
      for (let j = 0; j < per; j++) { const col = ws.getColumn(c0 + j); col.width = j === 0 ? 17 : 12; if (j > 0) { col.outlineLevel = 1; col.hidden = true; } }
    });
    hdr(3, lastCol, "Шкур, шт."); hdr(4, lastCol, ""); ws.mergeCells(3, lastCol, 4, lastCol);
    ws.getColumn(1).width = 36; ws.getColumn(lastCol).width = 11; ws.getRow(3).height = 34;

    let r = 5;
    const valueOf = (cells: Map<string, Cell>, auc: string | null, year: number | null): Cell => {
      let q = 0, s = 0;
      for (const [k, c] of cells) { const [a, y] = k.split("|"); if ((auc === null || a === auc) && (year === null || Number(y) === year)) { q += c.q; s += c.s; } }
      return { q, s };
    };
    const writeRow = (label: string, level: number, cells: Map<string, Cell>, style: "type" | "mid" | "sub") => {
      const row = ws.getRow(r++);
      row.outlineLevel = level;
      row.getCell(1).value = (style === "mid" ? "   " : style === "sub" ? "      " : "") + label;
      blocks.forEach((_, bi) => {
        const auc = bi < auctions.length ? auctions[bi].label : null;
        const c0 = 2 + bi * per;
        for (let j = 0; j < per; j++) {
          const v = valueOf(cells, auc, j === 0 ? null : years[j - 1]);
          const cell = row.getCell(c0 + j);
          cell.value = v.q > 0 ? v.s / v.q : null; cell.numFmt = USD; cell.alignment = { horizontal: "right" };
          if (j === 0) cell.font = { bold: true };
        }
      });
      const q = row.getCell(lastCol); q.value = valueOf(cells, null, null).q; q.numFmt = N0; q.alignment = { horizontal: "right" };
      for (let c = 1; c <= lastCol; c++) { const cell = row.getCell(c); if (style === "type") { cell.fill = fill(LAV); cell.font = { ...(cell.font ?? {}), bold: true, size: 12 }; } else if (style === "mid") { cell.fill = fill(PALE); cell.font = { ...(cell.font ?? {}), bold: true }; } cell.border = { bottom: { style: "hair", color: { argb: BR } } }; }
    };
    const grand = new Map<string, Cell>();
    const qtyOf = (m: Map<string, Cell>) => [...m.values()].reduce((a, c) => a + c.q, 0);
    const lastKey = (a: string) => (a === NO_ATTR || a === NO_COLOR ? 1 : 0);
    for (const [name, t] of [...tree.entries()].sort((a, b) => qtyOf(b[1].cells) - qtyOf(a[1].cells))) {
      writeRow(name, 0, t.cells, "type");
      for (const [k, c] of t.cells) add(grand, k, c.q, c.s);
      for (const [n1, node] of [...t.kids.entries()].sort((a, b) => lastKey(a[0]) - lastKey(b[0]) || qtyOf(b[1].cells) - qtyOf(a[1].cells) || a[0].localeCompare(b[0], "ru"))) {
        writeRow(n1, 1, node.cells, "mid");
        for (const [n2, m] of [...node.kids.entries()].sort((a, b) => lastKey(a[0]) - lastKey(b[0]) || qtyOf(b[1]) - qtyOf(a[1]) || a[0].localeCompare(b[0], "ru"))) writeRow(n2, 2, m, "sub");
      }
    }
    r++;
    writeRow("ИТОГО по всем типам меха", 0, grand, "type");
    ws.getRow(r - 1).eachCell((c) => { c.fill = fill(NAVY); c.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
  };

  makeSheet("Молоток $ по аукционам", "Тип меха / признак / цвет", buildTree(attrsOf, colorOf), "Тип меха → признак меха → цвет меха (как записан в лотах аукциона; «Цвет не указан» — где в документах цвета нет)");
  await wb.xlsx.writeFile(out);
  console.log(`готово: ${out}; аукционов ${auctions.length}, годы ${years.join(", ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
