import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { avgEff, BLOCK_LABEL, buildPcsTree, CAT_LABEL, ST_COLS, ST_LEN, stOf, type PcsDoc, type PcsNode } from "@/lib/budget-pcs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dateRu = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
const DATA = "Данные";
const dash = (s: string) => s || "—";

/** Колонка листа «Данные» по номеру (1 = A). */
const colL = (n: number) => { let o = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) o = String.fromCharCode(65 + ((x - 1) % 26)) + o; return o; };
const ST0 = 8; // первая колонка статистики на листе «Данные» (H)
const SRC_COL = ST0 + ST_LEN; // «Источник AVG»
const catOf = (c: string) => CAT_LABEL[c] ?? c;

/** Книга Budget PCS: 1) «Данные» — один массив строк, 2) «Сводная» — настоящая сводная таблица по нему, 3) «Отчёт» — оформлен как файл MVST и считается формулами по «Данные». */
export async function buildPcsWorkbook(doc: PcsDoc, opts: { pivot?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const wsD = wb.addWorksheet(DATA, { views: [{ state: "frozen", ySplit: 1 }] });
  const wsP = wb.addWorksheet("Сводная");
  const wsR = wb.addWorksheet("Отчёт", { views: [{ showGridLines: false, state: "frozen", xSplit: 1, ySplit: 6 }] });

  // ---- 1. Данные
  const head = wsD.addRow(["Блок", "Мех", "Категория", "Длина", "PCS", "AVG", "TTL", ...ST_COLS.map((c) => c.name), "Источник AVG"]);
  head.font = { bold: true }; head.alignment = { horizontal: "center", wrapText: true };
  const rows = doc.rows;
  rows.forEach((r, i) => {
    const a = avgEff(r), st = stOf(r);
    const row = wsD.addRow([BLOCK_LABEL[r.block], r.fur, catOf(r.cat), dash(r.len), r.pcs, a, null, ...st, r.avg != null ? "файл" : a != null ? "бюджет" : ""]);
    row.getCell(7).value = a != null ? { formula: `E${i + 2}*F${i + 2}`, result: r.pcs * a } : null;
    row.getCell(6).numFmt = "0.0"; row.getCell(7).numFmt = "#,##0";
    for (let k = 0; k < ST_LEN; k++) row.getCell(ST0 + k).numFmt = "#,##0";
    if (r.avg == null && a != null) row.getCell(6).font = { italic: true }; // норма бюджета — курсивом
  });
  wsD.columns = [{ width: 20 }, { width: 16 }, { width: 26 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 12 }, ...ST_COLS.map(() => ({ width: 13 })), { width: 12 }];
  wsD.autoFilter = { from: "A1", to: `${colL(SRC_COL)}${rows.length + 1}` };
  const LAST = rows.length + 1;

  // ---- 2. Сводная: заголовок; сама таблица добавляется в пакет ниже
  wsP.getCell("A1").value = `${doc.name}: сводная таблица по листу «${DATA}»`; wsP.getCell("A1").font = { bold: true, size: 12 };
  wsP.getCell("A2").value = "Откроется с обновлением данных. Правите лист «Данные» → Данные → Обновить всё.";
  wsP.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  wsP.columns = [{ width: 34 }, ...Array.from({ length: 3 + ST_LEN }, () => ({ width: 15 }))];

  // ---- 3. Отчёт
  const NC = 4 + ST_LEN; // A + PCS, AVG, TTL + статистика
  wsR.columns = [{ width: 38 }, { width: 9 }, { width: 11 }, { width: 11 }, ...ST_COLS.map((c) => ({ width: c.money ? 12 : 8 }))];
  const t = wsR.getCell("A1"); t.value = `${doc.name} — ${doc.supplier}`; t.font = { bold: true, size: 12, name: "Calibri" };
  wsR.getCell("A2").value = `Одежда обновлена ${dateRu(doc.asOf.RTW)} · аксессуары обновлены ${dateRu(doc.asOf.Acc)}. AVG курсивом: норма из бюджета (в файле пусто).`; wsR.getCell("A2").font = { size: 9, color: { argb: "FF6B7280" } };
  const thin = { bottom: { style: "thin" as const, color: { argb: "FF9CA3AF" } } };
  const hdr = (row: number, from: number, to: number, text: string) => { if (to > from) wsR.mergeCells(row, from, row, to); const c = wsR.getCell(row, from); c.value = text; c.font = { bold: true, size: 9 }; c.alignment = { horizontal: "center" }; };
  wsR.getCell("A4").value = doc.supplier; wsR.getCell("A4").font = { bold: true, size: 9 };
  hdr(4, 2, 4, doc.season || "Budget");
  // группы колонок статистики: 2026 / 2025 / Статистика, подгруппы по две колонки
  let k = 0;
  while (k < ST_LEN) { let e = k; while (e + 1 < ST_LEN && ST_COLS[e + 1].group === ST_COLS[k].group) e++; hdr(4, 5 + k, 5 + e, ST_COLS[k].group); k = e + 1; }
  for (let j = 0; j < ST_LEN; j += 2) hdr(5, 5 + j, 6 + j, ST_COLS[j].sub);
  const h6 = wsR.getRow(6); h6.values = [null, "PCS", "AVG (шкур)", "TTL (шкур)", ...ST_COLS.map((c) => (c.money ? (c.group === "Статистика" ? "NS AS" : "EUR") : "PCS"))];
  [4, 5, 6].forEach((rr) => { const rw = wsR.getRow(rr); rw.font = { bold: true, size: 9 }; rw.alignment = { horizontal: "center" }; rw.eachCell((c) => { if (rr === 6) c.border = thin; }); });

  const FILL: Record<number, { fg: string; font: string }> = { 0: { fg: "FF3F3F6F", font: "FFFFFFFF" }, 1: { fg: "FF7F7FAF", font: "FFFFFFFF" }, 2: { fg: "FFBFBFEF", font: "FF000000" }, 3: { fg: "FFBFBFEF", font: "FF000000" } };
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const D = (c: string) => `'${DATA}'!$${c}$2:$${c}$${LAST}`;
  const tree = buildPcsTree(rows);
  const both = tree.length > 1;
  let r = both ? 8 : 7; // при двух блоках первая строка — общий TOTAL
  const rootRows: number[] = [];
  const style = (row: number, level: number, bold: boolean) => {
    const f = FILL[level];
    for (let c = 1; c <= NC; c++) {
      const cell = wsR.getCell(row, c);
      cell.font = { name: "Calibri", size: 9, bold, color: f && level <= 3 ? { argb: f.font } : undefined };
      if (f && level <= 3) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f.fg } };
      if (c > 1) { cell.alignment = { horizontal: "right" }; cell.numFmt = c === 3 ? "0.0" : c === 4 ? "#,##0;-#,##0;" : "#,##0;-#,##0;"; }
    }
  };
  const writeNode = (n: PcsNode, keys: { block?: string; fur?: string; cat?: string; len?: string }) => {
    const row = r++;
    const k2 = { ...keys };
    const isGroup = n.level === 2 && n.children.length > 0 && n.children[0].level === 3; // группа аксессуаров: сумма по категориям
    if (n.level === 0) { k2.block = BLOCK_LABEL[n.key as "RTW" | "Acc"]; rootRows.push(row); }
    else if (n.level === 1) k2.fur = n.label;
    else if ((n.level === 2 && !isGroup) || n.level === 3) k2.cat = n.label;
    else if (n.level === 4) k2.len = n.label;
    if (n.leaf && n.level !== 4) k2.len = "—";
    const parts: string[] = [];
    if (k2.block) parts.push(`${D("A")},${q(k2.block)}`);
    if (k2.fur) parts.push(`${D("B")},${q(k2.fur)}`);
    if (k2.cat) parts.push(`${D("C")},${q(k2.cat)}`);
    if (k2.len) parts.push(`${D("D")},${q(k2.len)}`);
    const sumOf = (col: string, extra = "") => isGroup
      ? n.children.map((c) => `SUMIFS(${D(col)},${parts.join(",")},${D("C")},${q(c.label)}${extra})`).join("+")
      : `SUMIFS(${D(col)},${parts.join(",")}${extra})`;
    const avgDen = sumOf("E", `,${D("F")},"<>"`);
    wsR.getCell(row, 1).value = n.label;
    wsR.getCell(row, 2).value = { formula: sumOf("E"), result: n.pcs };
    wsR.getCell(row, 4).value = { formula: sumOf("G"), result: n.ttl };
    wsR.getCell(row, 3).value = { formula: `IF(${avgDen}>0,D${row}/(${avgDen}),"")`, result: n.hasAvg && n.pcsA > 0 ? n.ttl / n.pcsA : undefined };
    for (let j = 0; j < ST_LEN; j++) wsR.getCell(row, 5 + j).value = { formula: sumOf(colL(ST0 + j)), result: n.st[j] };
    style(row, n.level, n.level <= 3);
    wsR.getCell(row, 1).alignment = { indent: n.level === 4 ? 3 : n.level };
    if (n.ttlB > 0 && n.ttlB >= n.ttl - 0.5) wsR.getCell(row, 3).font = { ...wsR.getCell(row, 3).font, italic: true }; // весь AVG — норма бюджета
    if (n.level === 4) wsR.getRow(row).outlineLevel = 1;
    for (const c of n.children) writeNode(c, k2);
  };
  for (const root of tree) writeNode(root, {});
  if (both) { // общий итог: сумма корней одежды и аксессуаров
    const row = 7, [a, b2] = rootRows;
    const sum = (c: number) => ({ formula: `${colL(c)}${a}+${colL(c)}${b2}` });
    wsR.getCell(row, 1).value = "TOTAL (одежда + аксессуары)";
    wsR.getCell(row, 2).value = sum(2); wsR.getCell(row, 4).value = sum(4);
    const pa = `SUMIFS(${D("E")},${D("F")},"<>")`;
    wsR.getCell(row, 3).value = { formula: `IF(${pa}>0,D${row}/${pa},"")` };
    for (let j = 0; j < ST_LEN; j++) wsR.getCell(row, 5 + j).value = sum(5 + j);
    style(row, 0, true); wsR.getCell(row, 1).alignment = { indent: 0 };
  }
  wsR.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  wsR.pageSetup = { orientation: "landscape" }; // fitToPage вместе с outlineProperties ломает порядок sheetPr (Excel просит восстановить файл)

  const base = Buffer.from(await wb.xlsx.writeBuffer());
  return opts.pivot === false ? base : injectPivot(base, doc, LAST);
}

/** Добавляет в пакет настоящую сводную таблицу на листе 2 (кэш с refreshOnLoad: Excel соберёт значения при открытии). */
async function injectPivot(buf: Buffer, doc: PcsDoc, last: number): Promise<Buffer> {
  const rows = doc.rows;
  const uniq = (f: (r: (typeof rows)[number]) => string) => [...new Set(rows.map(f))];
  const sv = { Блок: uniq((r) => BLOCK_LABEL[r.block]), Мех: uniq((r) => r.fur), Категория: uniq((r) => catOf(r.cat)), Длина: uniq((r) => dash(r.len)) };
  const strField = (n: keyof typeof sv) => `<cacheField name="${n}" numFmtId="0"><sharedItems count="${sv[n].length}">${sv[n].map((v) => `<s v="${esc(v)}"/>`).join("")}</sharedItems></cacheField>`;
  const srcVals = [...new Set(rows.map((r) => (r.avg != null ? "файл" : avgEff(r) != null ? "бюджет" : "")))];
  const srcField = `<cacheField name="Источник AVG" numFmtId="0"><sharedItems count="${srcVals.length}">${srcVals.map((v) => `<s v="${esc(v)}"/>`).join("")}</sharedItems></cacheField>`;
  const numField = (n: string) => `<cacheField name="${n}" numFmtId="0"><sharedItems containsString="0" containsBlank="1" containsNumber="1"/></cacheField>`;
  const cache = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" refreshOnLoad="1" refreshedVersion="8" minRefreshableVersion="3" createdVersion="6" recordCount="${rows.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="A1:${colL(SRC_COL)}${last}" sheet="${DATA}"/></cacheSource><cacheFields count="${SRC_COL + 1}">` +
    strField("Блок") + strField("Мех") + strField("Категория") + strField("Длина") + numField("PCS") + numField("AVG") + numField("TTL") + ST_COLS.map((c) => numField(c.name)).join("") + srcField +
    `<cacheField name="AVG средневзв." numFmtId="0" formula="TTL/PCS" databaseField="0"/></cacheFields></pivotCacheDefinition>`;
  const axisRow = (n: keyof typeof sv) => `<pivotField axis="axisRow" showAll="0"><items count="${sv[n].length + 1}">${sv[n].map((_, k) => `<item x="${k}"/>`).join("")}<item t="default"/></items></pivotField>`;
  const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="Сводная Budget PCS" cacheId="1" showError="1" errorCaption="—" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Значения" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Блок / мех / категория / длина">` +
    `<location ref="A4:${colL(3 + ST_LEN + 1)}90" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="${SRC_COL + 1}">${axisRow("Блок")}${axisRow("Мех")}${axisRow("Категория")}${axisRow("Длина")}<pivotField dataField="1" showAll="0"/><pivotField showAll="0"/><pivotField dataField="1" showAll="0"/>${ST_COLS.map(() => '<pivotField dataField="1" showAll="0"/>').join("")}<pivotField showAll="0"/><pivotField dataField="1" dragToRow="0" dragToCol="0" dragToPage="0" showAll="0" defaultSubtotal="0"/></pivotFields>` +
    `<rowFields count="4"><field x="0"/><field x="1"/><field x="2"/><field x="3"/></rowFields><colFields count="1"><field x="-2"/></colFields>` +
    `<dataFields count="${3 + ST_LEN}"><dataField name="PCS, шт." fld="4" baseField="0" baseItem="0" numFmtId="3"/><dataField name="TTL, шкур" fld="6" baseField="0" baseItem="0" numFmtId="3"/><dataField name="AVG, шкур на изд." fld="${SRC_COL}" baseField="0" baseItem="0" numFmtId="2"/>${ST_COLS.map((c, i) => `<dataField name="Σ ${esc(c.name)}" fld="${ST0 - 1 + i}" baseField="0" baseItem="0" numFmtId="3"/>`).join("")}</dataFields>` +
    `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
  const zip = await JSZip.loadAsync(buf);
  const text = async (p: string) => (await zip.file(p)!.async("string"));
  zip.file("[Content_Types].xml", (await text("[Content_Types].xml")).replace("</Types>", '<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>'));
  zip.file("xl/workbook.xml", (await text("xl/workbook.xml")).replace("</workbook>", '<pivotCaches><pivotCache xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" cacheId="1" r:id="rIdPC1"/></pivotCaches></workbook>'));
  zip.file("xl/_rels/workbook.xml.rels", (await text("xl/_rels/workbook.xml.rels")).replace("</Relationships>", '<Relationship Id="rIdPC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>'));
  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", cache);
  zip.file("xl/pivotTables/pivotTable1.xml", pivot);
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>');
  const relPath = "xl/worksheets/_rels/sheet2.xml.rels";
  const pivotRel = '<Relationship Id="rIdPV1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>';
  zip.file(relPath, zip.file(relPath) ? (await text(relPath)).replace("</Relationships>", pivotRel + "</Relationships>") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pivotRel}</Relationships>`);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
