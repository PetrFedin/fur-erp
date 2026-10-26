import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { BLOCK_LABEL, buildPcsTree, type PcsDoc, type PcsNode } from "@/lib/budget-pcs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dateRu = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
const DATA = "Данные";
const dash = (s: string) => s || "—";

/** Книга Budget PCS: 1) «Данные» — один массив строк, 2) «Сводная» — настоящая сводная таблица по нему, 3) «Отчёт» — оформлен как файл MVST и считается формулами по «Данные». */
export async function buildPcsWorkbook(doc: PcsDoc, opts: { pivot?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const wsD = wb.addWorksheet(DATA, { views: [{ state: "frozen", ySplit: 1 }] });
  const wsP = wb.addWorksheet("Сводная");
  const wsR = wb.addWorksheet("Отчёт", { views: [{ showGridLines: false }] });

  // ---- 1. Данные
  const head = wsD.addRow(["Блок", "Мех", "Категория", "Длина", "PCS", "AVG", "TTL"]);
  head.font = { bold: true }; head.alignment = { horizontal: "center", wrapText: true };
  const rows = doc.rows;
  rows.forEach((r, i) => {
    const row = wsD.addRow([BLOCK_LABEL[r.block], r.fur, r.cat, dash(r.len), r.pcs, r.avg ?? null, null]);
    row.getCell(7).value = r.avg != null ? { formula: `E${i + 2}*F${i + 2}`, result: r.pcs * r.avg } : null;
    row.getCell(6).numFmt = "0.0"; row.getCell(7).numFmt = "#,##0";
  });
  wsD.columns = [{ width: 20 }, { width: 16 }, { width: 26 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 12 }];
  wsD.autoFilter = { from: "A1", to: `G${rows.length + 1}` };
  const LAST = rows.length + 1;

  // ---- 2. Сводная: заголовок; сама таблица добавляется в пакет ниже
  wsP.getCell("A1").value = `${doc.name}: сводная таблица по листу «${DATA}»`; wsP.getCell("A1").font = { bold: true, size: 12 };
  wsP.getCell("A2").value = "Откроется с обновлением данных. Правите лист «Данные» → Данные → Обновить всё.";
  wsP.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  wsP.columns = [{ width: 34 }, { width: 12 }, { width: 14 }, { width: 18 }];

  // ---- 3. Отчёт
  wsR.columns = [{ width: 38 }, { width: 9 }, { width: 11 }, { width: 11 }];
  const t = wsR.getCell("A1"); t.value = `${doc.name} — ${doc.supplier}`; t.font = { bold: true, size: 12, name: "Calibri" };
  wsR.getCell("A2").value = `Одежда обновлена ${dateRu(doc.asOf.RTW)} · аксессуары обновлены ${dateRu(doc.asOf.Acc)}`; wsR.getCell("A2").font = { size: 9, color: { argb: "FF6B7280" } };
  wsR.getRow(4).values = [doc.supplier, doc.season, null, null]; wsR.getCell("A4").font = { bold: true, size: 9 };
  wsR.mergeCells("B4:D4"); wsR.getCell("B4").alignment = { horizontal: "center" }; wsR.getCell("B4").font = { bold: true, size: 9 };
  const h5 = wsR.getRow(5); h5.values = [null, "PCS", "AVG (шкур)", "TTL (шкур)"]; h5.font = { bold: true, size: 9 }; h5.alignment = { horizontal: "center" };
  h5.eachCell((c) => { c.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } }; });

  const FILL: Record<number, { fg: string; font: string }> = { 0: { fg: "FF3F3F6F", font: "FFFFFFFF" }, 1: { fg: "FF7F7FAF", font: "FFFFFFFF" }, 2: { fg: "FFBFBFEF", font: "FF000000" }, 3: { fg: "FFBFBFEF", font: "FF000000" } };
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const D = (c: string) => `'${DATA}'!$${c}$2:$${c}$${LAST}`;
  const tree = buildPcsTree(rows);
  let r = 6;
  const writeNode = (n: PcsNode, keys: { block?: string; fur?: string; cat?: string; len?: string }) => {
    const row = r++;
    const f = FILL[n.level];
    const A = wsR.getCell(`A${row}`), B = wsR.getCell(`B${row}`), C = wsR.getCell(`C${row}`), Dc = wsR.getCell(`D${row}`);
    A.value = n.label;
    const k = { ...keys };
    const isGroup = n.level === 2 && n.children.length > 0 && n.children[0].level === 3; // группа аксессуаров: сумма по категориям
    if (n.level === 0) k.block = BLOCK_LABEL[n.key as "RTW" | "Acc"];
    else if (n.level === 1) k.fur = n.label;
    else if ((n.level === 2 && !isGroup) || n.level === 3) k.cat = n.label;
    else if (n.level === 4) k.len = n.label;
    if (n.leaf && n.level !== 4) k.len = "—";
    const parts: string[] = [];
    if (k.block) parts.push(`${D("A")},${q(k.block)}`);
    if (k.fur) parts.push(`${D("B")},${q(k.fur)}`);
    if (k.cat) parts.push(`${D("C")},${q(k.cat)}`);
    if (k.len) parts.push(`${D("D")},${q(k.len)}`);
    let pcsF: string, ttlF: string, avgDen: string;
    if (isGroup) {
      const cats = n.children.map((c) => `${D("C")},${q(c.label)}`);
      const sumOver = (col: string, extra = "") => cats.map((cc) => `SUMIFS(${D(col)},${parts.join(",")},${cc}${extra})`).join("+");
      pcsF = sumOver("E"); ttlF = sumOver("G"); avgDen = sumOver("E", `,${D("F")},"<>"`);
    } else {
      pcsF = `SUMIFS(${D("E")},${parts.join(",")})`; ttlF = `SUMIFS(${D("G")},${parts.join(",")})`; avgDen = `SUMIFS(${D("E")},${parts.join(",")},${D("F")},"<>")`;
    }
    B.value = { formula: pcsF, result: n.pcs }; Dc.value = { formula: ttlF, result: n.ttl };
    C.value = { formula: `IF(${avgDen}>0,D${row}/(${avgDen}),"")`, result: n.hasAvg && n.pcsA > 0 ? n.ttl / n.pcsA : undefined };
    [A, B, C, Dc].forEach((c) => {
      c.font = { name: "Calibri", size: 9, bold: n.level <= 3 && n.level !== 4, color: f ? { argb: f.font } : undefined };
      if (f && n.level <= 3) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f.fg } };
    });
    A.alignment = { indent: n.level === 4 ? 3 : n.level }; B.numFmt = "#,##0"; C.numFmt = "0.0"; Dc.numFmt = "#,##0;-#,##0;"; // ноль в TTL не показываем (нет AVG)
    [B, C, Dc].forEach((c) => (c.alignment = { horizontal: "right" }));
    if (n.level === 4) wsR.getRow(row).outlineLevel = 1;
    for (const c of n.children) writeNode(c, k);
  };
  for (const root of tree) writeNode(root, {});
  wsR.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  wsR.pageSetup = { orientation: "portrait" }; // fitToPage вместе с outlineProperties ломает порядок sheetPr (Excel просит восстановить файл)

  const base = Buffer.from(await wb.xlsx.writeBuffer());
  return opts.pivot === false ? base : injectPivot(base, doc, LAST);
}

/** Добавляет в пакет настоящую сводную таблицу на листе 2 (кэш с refreshOnLoad: Excel соберёт значения при открытии). */
async function injectPivot(buf: Buffer, doc: PcsDoc, last: number): Promise<Buffer> {
  const rows = doc.rows;
  const uniq = (f: (r: (typeof rows)[number]) => string) => [...new Set(rows.map(f))];
  const sv = { Блок: uniq((r) => BLOCK_LABEL[r.block]), Мех: uniq((r) => r.fur), Категория: uniq((r) => r.cat), Длина: uniq((r) => dash(r.len)) };
  const strField = (n: keyof typeof sv) => `<cacheField name="${n}" numFmtId="0"><sharedItems count="${sv[n].length}">${sv[n].map((v) => `<s v="${esc(v)}"/>`).join("")}</sharedItems></cacheField>`;
  const numField = (n: string) => `<cacheField name="${n}" numFmtId="0"><sharedItems containsString="0" containsBlank="1" containsNumber="1"/></cacheField>`;
  const cache = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" refreshOnLoad="1" refreshedVersion="8" minRefreshableVersion="3" createdVersion="6" recordCount="${rows.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="A1:G${last}" sheet="${DATA}"/></cacheSource><cacheFields count="8">` +
    strField("Блок") + strField("Мех") + strField("Категория") + strField("Длина") + numField("PCS") + numField("AVG") + numField("TTL") +
    `<cacheField name="AVG средневзв." numFmtId="0" formula="TTL/PCS" databaseField="0"/></cacheFields></pivotCacheDefinition>`;
  const axisRow = (n: keyof typeof sv) => `<pivotField axis="axisRow" showAll="0"><items count="${sv[n].length + 1}">${sv[n].map((_, k) => `<item x="${k}"/>`).join("")}<item t="default"/></items></pivotField>`;
  const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="Сводная Budget PCS" cacheId="1" showError="1" errorCaption="—" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Значения" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Блок / мех / категория / длина">` +
    `<location ref="A4:D80" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="8">${axisRow("Блок")}${axisRow("Мех")}${axisRow("Категория")}${axisRow("Длина")}<pivotField dataField="1" showAll="0"/><pivotField showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField dataField="1" dragToRow="0" dragToCol="0" dragToPage="0" showAll="0" defaultSubtotal="0"/></pivotFields>` +
    `<rowFields count="4"><field x="0"/><field x="1"/><field x="2"/><field x="3"/></rowFields><colFields count="1"><field x="-2"/></colFields>` +
    `<dataFields count="3"><dataField name="PCS, шт." fld="4" baseField="0" baseItem="0" numFmtId="3"/><dataField name="TTL, шкур" fld="6" baseField="0" baseItem="0" numFmtId="3"/><dataField name="AVG, шкур на изд." fld="7" baseField="0" baseItem="0" numFmtId="2"/></dataFields>` +
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
