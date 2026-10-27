import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { CASHFLOW_ARTICLES, split, TYPE_LABEL, type RowVatShare, type SalesMonthly } from "@/lib/cashflow";
import type { OverviewRow } from "@/lib/payments-overview";

/**
 * Книга Cash Flow: 1) «Данные» — один массив строк (платёж × статья и выручка по месяцам) с суммами с НДС, НДС и без НДС;
 * 2) «Сводная» — настоящая сводная таблица по этому массиву (Excel соберёт значения при открытии);
 * 3) «Отчёт» — тот же Cash Flow, что на экране: статьи в строках, месяцы и итоги года в столбцах, формулы SUMIFS по листу «Данные»; НДС — отдельным блоком снизу.
 * Знак: траты отрицательные, поступления положительные (как в таблице Cash Flow).
 */
const DATA = "Данные";
const NUM = "#,##0;-#,##0;–";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colL = (n: number) => { let o = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) o = String.fromCharCode(65 + ((x - 1) % 26)) + o; return o; };
const ruDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

type DRow = { month: string; year: string; section: "Траты" | "Поступления"; article: string; kind: string; object: string; doc: string; date: string; incl: number; vat: number; ex: number };
const HEAD = ["Месяц", "Год", "Раздел", "Статья", "Вид платежа", "Объект", "Основание", "Дата", "Сумма с НДС", "НДС", "Сумма без НДС"];
const LABEL: Record<string, string> = Object.fromEntries(CASHFLOW_ARTICLES.map((a) => [a.key, a.label]));
const REVENUE = "Выручка от продаж";

/** Строки листа «Данные»: каждая оплата делится по статьям (мех: аукционы / закупка, подкладка, услуги, работа), плюс выручка по месяцам. */
export function cashflowDataRows(rows: OverviewRow[], share: RowVatShare, months: string[], sales: SalesMonthly): DRow[] {
  const inPeriod = new Set(months);
  const out: DRow[] = [];
  for (const r of rows) {
    const month = r.iso.slice(0, 7);
    if (!inPeriod.has(month)) continue;
    const sh = share.get(r.id) ?? 0;
    const parts = split(r);
    // Шкуры подрядчика показываем в «Мех: закупка у поставщика» — как в таблице Cash Flow.
    const byArticle = new Map<string, number>();
    for (const [k, v] of Object.entries(parts)) if (Math.abs(v) > 0.005) { const lab = k === "hides" ? LABEL.furPurchase : LABEL[k]; byArticle.set(lab, (byArticle.get(lab) ?? 0) + v); }
    for (const [article, v] of byArticle) {
      out.push({ month, year: month.slice(0, 4), section: "Траты", article, kind: TYPE_LABEL[r.type], object: r.label, doc: r.doc ?? "", date: ruDate(r.iso), incl: -v, vat: -v * sh, ex: -v * (1 - sh) });
    }
  }
  if (sales.available) {
    months.forEach((m, i) => {
      const incl = sales.revIncl[i] ?? 0, ex = sales.revEx[i] ?? 0;
      if (Math.abs(incl) < 0.005 && Math.abs(ex) < 0.005) return;
      out.push({ month: m, year: m.slice(0, 4), section: "Поступления", article: REVENUE, kind: "", object: "Продажи по файлу «поступления и продажи»", doc: "", date: "", incl, vat: incl - ex, ex });
    });
  }
  return out;
}

export async function buildCashflowWorkbook(opts: { title: string; subtitle: string; months: string[]; data: DRow[]; hasSales: boolean }): Promise<Buffer> {
  const { months, data } = opts;
  const wb = new ExcelJS.Workbook();
  // 1. Данные
  const wsD = wb.addWorksheet(DATA, { views: [{ state: "frozen", ySplit: 1 }] });
  wsD.addRow(HEAD).font = { bold: true };
  wsD.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; });
  for (const r of data) wsD.addRow([r.month, r.year, r.section, r.article, r.kind, r.object, r.doc, r.date, r.incl, r.vat, r.ex]);
  for (const c of [9, 10, 11]) { wsD.getColumn(c).numFmt = NUM; wsD.getColumn(c).width = 16; }
  [10, 6, 13, 30, 20, 38, 50, 12].forEach((w, i) => { wsD.getColumn(i + 1).width = w; });
  const last = data.length + 1;
  wsD.autoFilter = { from: "A1", to: `K${last}` };
  // 2. Сводная (лист-заготовка: таблицу вставляем в пакет ниже)
  const wsP = wb.addWorksheet("Сводная");
  wsP.getCell("A1").value = "Сводная таблица по листу «Данные»: траты и поступления по статьям и месяцам, ₽ с НДС. Откройте «Данные → Обновить всё», если значения не появились.";
  wsP.getCell("A1").font = { bold: true };
  // 3. Отчёт
  const ws = wb.addWorksheet("Отчёт", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }] });
  ws.addRow([opts.title]).font = { bold: true, size: 14 };
  ws.addRow([opts.subtitle]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  type Col = { key: string; label: string; crit: "month" | "year" | "all"; value: string };
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].filter((y) => data.some((d) => d.year === y));
  const cols: Col[] = [];
  for (const y of years) {
    for (const m of months.filter((x) => x.startsWith(y) && data.some((d) => d.month === x))) cols.push({ key: m, label: m.slice(5, 7) + "." + m.slice(2, 4), crit: "month", value: m });
    cols.push({ key: "y" + y, label: "Итого " + y, crit: "year", value: y });
  }
  cols.push({ key: "all", label: "Всего", crit: "all", value: "" });
  const headRow = ws.addRow(["Статья, ₽", ...cols.map((c) => c.label)]);
  headRow.font = { bold: true };
  headRow.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; c.alignment = { horizontal: "center", wrapText: true }; });
  const keyRow = ws.addRow(["ключ", ...cols.map((c) => c.value)]);
  keyRow.font = { color: { argb: "FF999999" }, size: 8 };
  keyRow.hidden = true;
  const NC = cols.length + 1;
  const sumData = (col: "incl" | "vat" | "ex", f: { section?: string; article?: string }, c: Col) => data.filter((d) => (!f.section || d.section === f.section) && (!f.article || d.article === f.article) && (c.crit === "all" || (c.crit === "year" ? d.year === c.value : d.month === c.value))).reduce((t, d) => t + d[col], 0);
  const F = { incl: "I", vat: "J", ex: "K" } as const;
  const formula = (col: "incl" | "vat" | "ex", f: { section?: string; article?: string }, ci: number, c: Col) => {
    const L = colL(ci);
    const crit = [f.section ? `${DATA}!$C:$C,"${f.section}"` : "", f.article ? `${DATA}!$D:$D,"${f.article.replace(/"/g, '""')}"` : "", c.crit === "month" ? `${DATA}!$A:$A,${L}$5` : c.crit === "year" ? `${DATA}!$B:$B,${L}$5` : ""].filter(Boolean).join(",");
    return `SUMIFS(${DATA}!$${F[col]}:$${F[col]}${crit ? "," + crit : ""})`;
  };
  // Строки отчёта: лист (SUMIFS по «Данные») или сумма других строк (плюс / минус). Номера строк известны заранее — формулы ссылаются на них.
  type Spec = { id: string; label: string; lvl: 0 | 1 | 2; leaf?: { col: "incl" | "vat" | "ex"; section: string; article?: string; sign: 1 | -1 }; plus?: string[]; minus?: string[]; gap?: boolean; head?: boolean };
  const A = (k: keyof typeof LABEL) => LABEL[k];
  const specs: Spec[] = [
    ...(opts.hasSales ? [{ id: "rev0", label: "ПОСТУПЛЕНИЯ", lvl: 0 as const, plus: ["rev1"] }, { id: "rev1", label: REVENUE, lvl: 1 as const, leaf: { col: "incl" as const, section: "Поступления", article: REVENUE, sign: 1 as const } }] : []),
    { id: "pay0", label: "ПЛАТЕЖИ", lvl: 0, plus: ["raw", "wrk"] },
    { id: "raw", label: "Сырьё и материалы", lvl: 1, plus: ["a1", "a2", "a3"] },
    { id: "a1", label: A("furAuction"), lvl: 2, leaf: { col: "incl", section: "Траты", article: A("furAuction"), sign: 1 } },
    { id: "a2", label: A("furPurchase"), lvl: 2, leaf: { col: "incl", section: "Траты", article: A("furPurchase"), sign: 1 } },
    { id: "a3", label: A("lining"), lvl: 2, leaf: { col: "incl", section: "Траты", article: A("lining"), sign: 1 } },
    { id: "wrk", label: "Работа и услуги", lvl: 1, plus: ["a4", "a5"] },
    { id: "a4", label: A("work"), lvl: 2, leaf: { col: "incl", section: "Траты", article: A("work"), sign: 1 } },
    { id: "a5", label: A("services"), lvl: 2, leaf: { col: "incl", section: "Траты", article: A("services"), sign: 1 } },
    ...(opts.hasSales ? [{ id: "net", label: "ЧИСТЫЙ ДЕНЕЖНЫЙ ПОТОК", lvl: 0 as const, plus: ["rev0", "pay0"] }, { id: "cum", label: "Накопленный чистый поток", lvl: 1 as const }] : []),
    { id: "gap", label: "", lvl: 1, gap: true },
    { id: "vhead", label: "НДС (отдельно), ₽", lvl: 0, head: true },
    { id: "v1", label: "НДС в составе платежей", lvl: 1, leaf: { col: "vat", section: "Траты", sign: -1 } },
    ...(opts.hasSales ? [{ id: "v2", label: "НДС в составе выручки", lvl: 1 as const, leaf: { col: "vat" as const, section: "Поступления", sign: 1 as const } }, { id: "v3", label: "Разница НДС (выручка − платежи)", lvl: 1 as const, plus: ["v2"], minus: ["v1"] }] : []),
    { id: "e1", label: "Платежи без НДС", lvl: 1, leaf: { col: "ex", section: "Траты", sign: 1 } },
    ...(opts.hasSales ? [{ id: "e2", label: "Выручка без НДС", lvl: 1 as const, leaf: { col: "ex" as const, section: "Поступления", sign: 1 as const } }, { id: "e3", label: "Чистый денежный поток без НДС", lvl: 0 as const, plus: ["e1", "e2"] }] : []),
  ];
  const first = ws.rowCount + 1;
  const rowNo = new Map(specs.map((sp, k) => [sp.id, first + k]));
  const byId = new Map(specs.map((sp) => [sp.id, sp]));
  const memo = new Map<string, number>();
  const val = (id: string, c: Col): number => {
    const key = id + "|" + c.key;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const sp = byId.get(id)!;
    let v = 0;
    if (sp.leaf) v = sp.leaf.sign * sumData(sp.leaf.col, { section: sp.leaf.section, article: sp.leaf.article }, c);
    else if (id === "cum") {
      const lastOf = c.crit === "month" ? c : [...cols].reverse().find((x) => x.crit === "month" && (c.crit === "all" || x.value.startsWith(c.value)));
      v = lastOf ? cols.slice(0, cols.indexOf(lastOf) + 1).filter((x) => x.crit === "month").reduce((t, x) => t + val("net", x), 0) : 0;
    }
    else v = (sp.plus ?? []).reduce((t, x) => t + val(x, c), 0) - (sp.minus ?? []).reduce((t, x) => t + val(x, c), 0);
    memo.set(key, v);
    return v;
  };
  for (const sp of specs) {
    const row = ws.addRow([sp.label]);
    if (sp.gap) continue;
    row.getCell(1).alignment = { indent: sp.lvl === 2 ? 2 : sp.lvl === 1 ? 1 : 0 };
    if (sp.head) { row.font = { bold: true }; row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; }); continue; }
    cols.forEach((c, i) => {
      const ci = i + 2, L = colL(ci);
      let f: string;
      if (sp.leaf) f = (sp.leaf.sign < 0 ? "-" : "") + formula(sp.leaf.col, { section: sp.leaf.section, article: sp.leaf.article }, ci, c);
      else if (sp.id === "cum") {
        if (c.crit === "month") { const prevMonth = cols.slice(0, i).reverse().find((x) => x.crit === "month"); f = prevMonth ? `${colL(cols.indexOf(prevMonth) + 2)}${rowNo.get("cum")}+${L}${rowNo.get("net")}` : `${L}${rowNo.get("net")}`; }
        else { const tgt = [...cols].reverse().find((x) => x.crit === "month" && (c.crit === "all" || x.value.startsWith(c.value))); f = tgt ? `${colL(cols.indexOf(tgt) + 2)}${rowNo.get("cum")}` : "0"; }
      } else f = [...(sp.plus ?? []).map((x) => `${L}${rowNo.get(x)}`), ...(sp.minus ?? []).map((x) => `-${L}${rowNo.get(x)}`)].join("+").replace(/\+-/g, "-");
      row.getCell(ci).value = { formula: f, result: val(sp.id, c) };
      row.getCell(ci).numFmt = NUM;
    });
    if (sp.lvl === 0) { row.font = { bold: true }; row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } }; }); } else if (sp.lvl === 1) row.font = { bold: true };
  }
  ws.getColumn(1).width = 44;
  for (let c = 2; c <= NC; c++) ws.getColumn(c).width = 15;
  // Тонкие линии
  const lineC = { style: "thin" as const, color: { argb: "FFC9C9D9" } };
  for (let rr = 4; rr <= ws.rowCount; rr++) { if (rr === 5) continue; for (let c = 1; c <= NC; c++) ws.getCell(rr, c).border = { top: lineC, bottom: lineC, left: lineC, right: lineC }; }
  ws.pageSetup = { orientation: "landscape" };

  const base = Buffer.from(await wb.xlsx.writeBuffer());
  return injectPivot(base, data, last);
}

/** Настоящая сводная таблица на листе 2: строки — раздел и статья, столбцы — месяцы, значения — сумма с НДС. Кэш с refreshOnLoad: Excel соберёт значения при открытии. */
async function injectPivot(buf: Buffer, data: DRow[], last: number): Promise<Buffer> {
  const uniq = (f: (r: DRow) => string) => [...new Set(data.map(f))];
  const str = [
    { name: HEAD[0], vals: uniq((r) => r.month) }, { name: HEAD[1], vals: uniq((r) => r.year) }, { name: HEAD[2], vals: uniq((r) => r.section) }, { name: HEAD[3], vals: uniq((r) => r.article) },
    { name: HEAD[4], vals: uniq((r) => r.kind) }, { name: HEAD[5], vals: uniq((r) => r.object) }, { name: HEAD[6], vals: uniq((r) => r.doc) }, { name: HEAD[7], vals: uniq((r) => r.date) },
  ];
  const strField = (f: { name: string; vals: string[] }) => `<cacheField name="${esc(f.name)}" numFmtId="0"><sharedItems count="${f.vals.length}">${f.vals.map((v) => `<s v="${esc(v)}"/>`).join("")}</sharedItems></cacheField>`;
  const numField = (n: string) => `<cacheField name="${esc(n)}" numFmtId="0"><sharedItems containsString="0" containsBlank="1" containsNumber="1"/></cacheField>`;
  const cache = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" refreshOnLoad="1" refreshedVersion="8" minRefreshableVersion="3" createdVersion="6" recordCount="${data.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="A1:K${last}" sheet="${DATA}"/></cacheSource><cacheFields count="11">${str.map(strField).join("")}${numField(HEAD[8])}${numField(HEAD[9])}${numField(HEAD[10])}</cacheFields></pivotCacheDefinition>`;
  const items = (n: number) => `<items count="${n + 1}">${Array.from({ length: n }, (_, k) => `<item x="${k}"/>`).join("")}<item t="default"/></items>`;
  const axis = (ax: "axisRow" | "axisCol", n: number) => `<pivotField axis="${ax}" showAll="0">${items(n)}</pivotField>`;
  const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="Сводная Cash Flow" cacheId="1" showError="1" errorCaption="—" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Значения" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Раздел / статья" colHeaderCaption="Месяц">` +
    `<location ref="A4:Z30" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="11">${axis("axisCol", str[0].vals.length)}<pivotField showAll="0"/>${axis("axisRow", str[2].vals.length)}${axis("axisRow", str[3].vals.length)}<pivotField showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/></pivotFields>` +
    `<rowFields count="2"><field x="2"/><field x="3"/></rowFields><colFields count="1"><field x="0"/></colFields>` +
    `<dataFields count="1"><dataField name="Сумма с НДС, ₽" fld="8" baseField="0" baseItem="0" numFmtId="3"/></dataFields>` +
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
